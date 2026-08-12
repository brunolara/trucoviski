/* ------------------------------------------------------------------ */
/*  TrucoRoom – sala Colyseus para 4 jogadores (F3: bots + nicknames)  */
/* ------------------------------------------------------------------ */

import { Room, matchMaker, type Client } from "colyseus";
import { randomInt } from "node:crypto";
import { createMatch, paulista, teamForSeat } from "@trucoviski/engine";
import { PRNG_VERSION } from "@trucoviski/engine";
import type { Seat, GameEvent, PlayerView } from "@trucoviski/engine";
import {
  NICKNAME_MAX_LENGTH,
  generateRoomCode,
  pickUniquePlayerNames,
  validateAction,
  validateSetNickname,
  validateSwapSeats,
  validateChat,
  validateEmote,
  validateThrowTomato,
} from "@trucoviski/shared";
import type { LogEntry, SnapshotMessage, WireError } from "@trucoviski/shared";
import { decideBotAction } from "@trucoviski/bots";
import { logger } from "./logger.js";

// ---- Constantes ------------------------------------------------------

const MAX_SEATS = 4;
const RECONNECT_SECONDS = 180;
/** Sala vazia (nenhum humano conectado) sobrevive esse tempo. D-sala-1. */
const EMPTY_ROOM_TTL_MS = 5 * 60_000;
const BOT_DELAY_MS = 1000;
const BOT_DELAY_AFTER_VAZA_OR_HAND_MS = 2600;

/** Identidade do navegador; sem ela, cai no sessionId (identidade da conexão). */
function readClientId(
  client: Client,
  options?: Record<string, unknown>,
): string {
  const raw = options?.["clientId"];
  return typeof raw === "string" && raw.trim().length >= 8
    ? raw.trim().slice(0, 64)
    : client.sessionId;
}
/** Partida de 12 tentos não passa de ~400 linhas; corta as antigas. */
const MAX_LOG_ENTRIES = 600;

/** 5 personas × 5 veredictos. Só tabela — a decisão vem do bot, não daqui. */
const PERSONAS = [
  {
    accept: "Aceita! Tenho carta.",
    run: "Corre, tô sem nada.",
    raise: "Aumenta! Tô com tudo.",
    play: "Joga! Nossas cartas prestam.",
    fold: "Melhor correr, tá magro aqui.",
  },
  {
    // valentão
    accept: "Aceita isso, parceiro!",
    run: "Corre! Não dá pra segurar.",
    raise: "Sobe pra doze! Tô lascado de bom.",
    play: "Vamo jogar! Eles que se cuidem.",
    fold: "Corre dessa, não vale o risco.",
  },
  {
    // resmungão
    accept: "Pode aceitar, dá pra brigar.",
    run: "Corre logo, tô com lixo.",
    raise: "Aumenta. Eles tão blefando.",
    play: "Joga, mas sem chorar depois.",
    fold: "Corre. Não temos nada aqui.",
  },
  {
    // caipira
    accept: "Aceita sim sinhô, tô bem servido.",
    run: "Corre, uai! Minha mão é fraca.",
    raise: "Aumenta essa, tô com as boa!",
    play: "Bora jogar, tá bom demais.",
    fold: "Foge dessa, num dá não.",
  },
  {
    // analítico
    accept: "Aceita: minha carta cobre.",
    run: "Corre, a chance é ruim.",
    raise: "Aumenta, temos vantagem clara.",
    play: "Joga, o par tá acima da média.",
    fold: "Corre, o par não sustenta.",
  },
] as const;

/**
 * Conselho do bot sobre a decisão de equipe pendente, só a partir da
 * PlayerView dele. A persona é o seat: fixa a partida inteira, sem estado novo.
 */
export function botAdvice(view: PlayerView): string | null {
  const persona = PERSONAS[view.mySeat % PERSONAS.length];
  if (!persona) return null;
  const action = decideBotAction(withTrucoResponse(view));
  if (action?.type === "truco") return persona[action.action] ?? null;
  if (action?.type === "elevenDecision")
    return action.decision === "play" ? persona.play : persona.fold;
  return null;
}

/**
 * O engine só dá accept/run/raise ao assento que está sendo pedido. Para o
 * parceiro bot opinar sobre um truco que o humano é quem responde, ele precisa
 * receber a mesma pergunta na mão dele.
 */
function withTrucoResponse(view: PlayerView): PlayerView {
  if (view.trucoPendingTeam === null) return view;
  if (view.trucoPendingTeam === teamForSeat(view.mySeat)) return view;
  if (view.legalActions.some((a) => a.type === "truco")) return view;

  const seq = paulista.trucoSequence;
  const canRaise =
    view.trucoPendingValue !== null &&
    seq.indexOf(view.trucoPendingValue) < seq.length - 1;

  return {
    ...view,
    legalActions: [
      ...view.legalActions,
      { type: "truco", action: "accept" },
      { type: "truco", action: "run" },
      ...(canRaise ? [{ type: "truco", action: "raise" } as const] : []),
    ],
  };
}

function hasHoldEvent(events: readonly GameEvent[]): boolean {
  return events.some(
    (e) => e.type === "vazaCompleted" || e.type === "handFinished",
  );
}

// ---- Helper de seed --------------------------------------------------

function validateSeed(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return randomInt(0, 2147483648);
  }
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw)
  ) {
    throw new Error("seed must be a finite integer");
  }
  if (raw < 0 || raw > 2147483647) {
    throw new Error("seed must be an integer in [0, 2147483647]");
  }
  return raw;
}

// ---- TrucoRoom -------------------------------------------------------

interface RoomState {
  status: "waiting" | "playing" | "finished";
}

export class TrucoRoom extends Room<{ state: RoomState }> {
  override maxClients = MAX_SEATS;

  /** sessionId → seat (0-3). */
  private occupied = new Map<string, number>();

  /** Seats livres, ordenados. */
  private freeSeats: number[] = [0, 1, 2, 3];

  /** Seat → nickname. */
  private nicknames = new Map<number, string>();

  /** Seats ocupados por bots. */
  private botSeats = new Set<number>();

  /** Dono de verdade: clientId de quem criou a sala. Nunca é sobrescrito. */
  private ownerClientId: string | null = null;

  /** clientId → assento guardado (para retomar depois do F5 / rejoin). */
  // ponytail: cresce com visitantes distintos; se um dia importar, podar no dispose
  private seatByClient = new Map<string, number>();

  /** sessionId → clientId (userData pode não estar no cliente do onMessage). */
  private clientIds = new Map<string, string>();

  /** Dono rearranjou assentos no lobby — não renormalizar em fillBots. */
  private seatsArranged = false;

  private match!: ReturnType<typeof createMatch>;

  private status: "waiting" | "playing" | "finished" = "waiting";

  /** Flag para impedir disconnect recursivo no fail-closed. */
  private closing = false;

  /** Flag para evitar dispatches concorrentes de bots. */
  private botDispatching = false;

  /** Timer ID do próximo dispatch de bot (para limpeza no dispose). */
  private botTimerId: ReturnType<typeof setTimeout> | null = null;

  /** Timer do descarte por inatividade. */
  private emptyTimerId: ReturnType<typeof setTimeout> | null = null;

  /** sessionId → timestamp da última mensagem de chat. */
  private lastChatTime = new Map<string, number>();

  /** sessionId → timestamp do último emote. */
  private lastEmoteTime = new Map<string, number>();

  /** sessionId → timestamp do último tomate. */
  private lastTomatoTime = new Map<string, number>();

  /** Dedupe: um conselho por pedido de truco / mão de onze. */
  private lastAdviceKey: string | null = null;

  /** Histórico da partida (console do cliente). */
  private log: LogEntry[] = [];

  // -- Lifecycle -------------------------------------------------------

  override onCreate(options: Record<string, unknown>): void {
    this.roomId = this.pickRoomCode();
    const seed = validateSeed(options.seed);
    this.match = createMatch(paulista, seed);
    this.setState({ status: this.status });

    // ponytail: a engine não emite handStarted da mão 1 (match.ts:74).
    const st = this.match.state();
    if (st.hand) {
      this.log.push({
        kind: "event",
        t: Date.now(),
        event: {
          type: "handStarted",
          handNumber: st.handNumber,
          dealerSeat: st.dealerSeat,
          vira: st.hand.vira,
        },
      });
    }

    // ponytail: sem autoDispose a sala só morre pelo nosso TTL — toda saída
    // precisa passar por armEmptyTimerIfEmpty(), senão vaza sala pra sempre.
    this.autoDispose = false;
    this.armEmptyTimer();

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, type, message);
    });
  }

  override onDispose(): void {
    this.clearBotTimer();
    this.clearEmptyTimer();
  }

  override onJoin(client: Client, options?: Record<string, unknown>): void {
    this.clearEmptyTimer();

    const clientId = readClientId(client, options);
    client.userData = { clientId };
    this.clientIds.set(client.sessionId, clientId);
    const remembered = this.seatByClient.get(clientId);

    // Partida em curso: só volta quem tem assento guardado que está com bot.
    if (this.status !== "waiting") {
      if (remembered === undefined || !this.botSeats.has(remembered)) {
        client.leave();
        this.armEmptyTimerIfEmpty();
        return;
      }
      this.botSeats.delete(remembered);
      this.occupied.set(client.sessionId, remembered);
      const nickname =
        this.nicknames.get(remembered) ?? `Jogador ${remembered + 1}`;
      this.pushSocial({
        kind: "system",
        t: Date.now(),
        text: `${nickname} voltou.`,
      });
      this.scheduleBotTurn();
      return; // pushSocial já faz broadcast
    }

    // Lobby: prefere o assento guardado, se ainda estiver livre ou com bot.
    if (remembered !== undefined && this.botSeats.has(remembered)) {
      this.botSeats.delete(remembered);
      this.occupied.set(client.sessionId, remembered);
      this.seatByClient.set(clientId, remembered);
      const nickname =
        typeof options?.nickname === "string" && options.nickname.trim()
          ? options.nickname.trim().slice(0, NICKNAME_MAX_LENGTH)
          : (this.nicknames.get(remembered) ?? `Jogador ${remembered + 1}`);
      this.nicknames.set(remembered, nickname);
      if (!this.ownerClientId) this.ownerClientId = clientId;
      this.broadcastSnapshots([]);
      return;
    }

    const seat =
      remembered !== undefined && this.freeSeats.includes(remembered)
        ? remembered
        : this.freeSeats[0];
    if (seat === undefined) {
      client.leave();
      return;
    }
    this.freeSeats = this.freeSeats.filter((s) => s !== seat);
    this.occupied.set(client.sessionId, seat);
    this.seatByClient.set(clientId, seat);

    const nickname =
      typeof options?.nickname === "string" && options.nickname.trim()
        ? options.nickname.trim().slice(0, NICKNAME_MAX_LENGTH)
        : `Jogador ${seat + 1}`;
    this.nicknames.set(seat, nickname);

    if (!this.ownerClientId) this.ownerClientId = clientId;

    this.broadcastSnapshots([]);
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const consented = code === 1000 || code === 4000;

    if (this.status === "waiting") {
      this.occupied.delete(client.sessionId);
      this.nicknames.delete(seat);
      this.freeSeats.push(seat);
      this.freeSeats.sort((a, b) => a - b);
      this.broadcastSnapshots([]);
      this.armEmptyTimerIfEmpty();
      return;
    }

    if (this.status === "playing") {
      const nickname = this.nicknames.get(seat) ?? `Jogador ${seat + 1}`;
      this.occupied.delete(client.sessionId);
      this.botSeats.add(seat);
      this.pushSocial({
        kind: "system",
        t: Date.now(),
        text: `${nickname} ${consented ? "saiu" : "caiu"} — bot assumiu.`,
      });
      if (this.occupied.size === 0) {
        this.pauseBots();
        this.armEmptyTimer();
      } else {
        this.scheduleBotTurn();
      }

      if (consented) {
        this.armEmptyTimerIfEmpty();
        return;
      }

      try {
        const newClient = await this.allowReconnection(
          client,
          RECONNECT_SECONDS,
        );
        const newSessionId = newClient.sessionId;
        this.botSeats.delete(seat);
        this.occupied.set(newSessionId, seat);
        this.clientIds.set(
          newSessionId,
          this.clientIds.get(client.sessionId) ?? this.clientIdOf(newClient),
        );

        if (newSessionId !== client.sessionId) {
          const chatT = this.lastChatTime.get(client.sessionId);
          if (chatT) this.lastChatTime.set(newSessionId, chatT);
          const emoteT = this.lastEmoteTime.get(client.sessionId);
          if (emoteT) this.lastEmoteTime.set(newSessionId, emoteT);
          const tomatoT = this.lastTomatoTime.get(client.sessionId);
          if (tomatoT) this.lastTomatoTime.set(newSessionId, tomatoT);
        }

        this.clearEmptyTimer();
        this.scheduleBotTurn();
        this.pushSocial({
          kind: "system",
          t: Date.now(),
          text: `${nickname} voltou.`,
        });
      } catch {
        this.armEmptyTimerIfEmpty();
      }
      return;
    }

    this.occupied.delete(client.sessionId);
    this.broadcastSnapshots([]);
    this.armEmptyTimerIfEmpty();
  }

  // -- Handlers de mensagem --------------------------------------------

  private handleMessage(
    client: Client,
    type: string | number,
    message: unknown,
  ): void {
    if (typeof type !== "string") return;

    if (type === "sync") {
      const seat = this.occupied.get(client.sessionId);
      if (seat !== undefined) {
        this.sendSnapshot(client, seat, []);
      }
      return;
    }

    if (type === "fillBots") {
      this.handleFillBots(client);
      return;
    }

    if (type === "startGame") {
      if (this.isOwnerClient(client)) this.startGame();
      return;
    }

    if (type === "swapSeats") {
      this.handleSwapSeats(client, message);
      return;
    }

    if (type === "setNickname") {
      this.handleSetNickname(client, message);
      return;
    }

    if (type === "action") {
      this.handleAction(client, message);
      return;
    }

    if (type === "chat") {
      this.handleChat(client, message);
      return;
    }

    if (type === "emote") {
      this.handleEmote(client, message);
      return;
    }

    if (type === "throwTomato") {
      this.handleThrowTomato(client, message);
      return;
    }

    // Mensagem desconhecida – ignora.
  }

  // -- startGame / fillBots / swapSeats ---------------------------------

  private startGame(): void {
    if (this.status !== "waiting") return;
    if (this.occupied.size + this.botSeats.size !== MAX_SEATS) return;
    this.status = "playing";
    this.setState({ status: this.status });
    this.broadcastSnapshots([]);
    this.scheduleBotTurn();
  }

  private handleFillBots(client: Client): void {
    // Só o dono pode preencher.
    if (!this.isOwnerClient(client)) return;

    // Só no lobby (waiting).
    if (this.status !== "waiting") return;

    // Normaliza assentos: humanos (na ordem em que entraram) ocupam os
    // assentos mais baixos (0..N-1); bots preenchem o resto. Com 2 humanos
    // isso garante 1 humano por time (times são 0/2 vs 1/3).
    // Se o dono já rearranjou, preserva o arranjo.
    if (!this.seatsArranged) this.normalizeHumanSeats();

    const seatsToFill = [...this.freeSeats];
    if (seatsToFill.length === 0) return;

    const taken = new Set(this.nicknames.values());
    const botNames = pickUniquePlayerNames(seatsToFill.length, taken, (n) =>
      randomInt(n),
    );

    seatsToFill.forEach((seat, i) => {
      const name = botNames[i] ?? `Bot ${seat + 1}`;
      this.botSeats.add(seat);
      this.nicknames.set(seat, name);

      const idx = this.freeSeats.indexOf(seat);
      if (idx !== -1) this.freeSeats.splice(idx, 1);
    });

    // ponytail: não apaga seatByClient — D-sala-5: quem saiu do lobby retoma
    // o assento se ele estiver com bot (dono que deu F5 incluso).
    this.broadcastSnapshots([]);
  }

  private handleSwapSeats(client: Client, message: unknown): void {
    if (!this.isOwnerClient(client)) return;
    if (this.status !== "waiting") return;
    const p = validateSwapSeats(message);
    if (!p || p.a === p.b) return;
    this.swapSeat(p.a, p.b);
    this.seatsArranged = true;
    this.broadcastSnapshots([]);
  }

  /** Troca a ocupação de dois assentos nas quatro estruturas indexadas. */
  private swapSeat(a: number, b: number): void {
    let sessionA: string | undefined;
    let sessionB: string | undefined;
    for (const [sessionId, seat] of this.occupied) {
      if (seat === a) sessionA = sessionId;
      if (seat === b) sessionB = sessionId;
    }
    if (sessionA !== undefined) this.occupied.set(sessionA, b);
    if (sessionB !== undefined) this.occupied.set(sessionB, a);

    const aIsBot = this.botSeats.has(a);
    const bIsBot = this.botSeats.has(b);
    if (aIsBot !== bIsBot) {
      if (aIsBot) {
        this.botSeats.delete(a);
        this.botSeats.add(b);
      } else {
        this.botSeats.delete(b);
        this.botSeats.add(a);
      }
    }

    const nickA = this.nicknames.get(a);
    const nickB = this.nicknames.get(b);
    if (nickB !== undefined) this.nicknames.set(a, nickB);
    else this.nicknames.delete(a);
    if (nickA !== undefined) this.nicknames.set(b, nickA);
    else this.nicknames.delete(b);

    const aFree = this.freeSeats.includes(a);
    const bFree = this.freeSeats.includes(b);
    if (aFree !== bFree) {
      if (aFree) {
        this.freeSeats = this.freeSeats.filter((s) => s !== a);
        this.freeSeats.push(b);
      } else {
        this.freeSeats = this.freeSeats.filter((s) => s !== b);
        this.freeSeats.push(a);
      }
      this.freeSeats.sort((x, y) => x - y);
    }

    for (const [clientId, seat] of [...this.seatByClient]) {
      if (seat === a) this.seatByClient.set(clientId, b);
      else if (seat === b) this.seatByClient.set(clientId, a);
    }
  }

  /** Reatribui humanos aos assentos mais baixos livres, sem roubar reserva de ausente. */
  private normalizeHumanSeats(): void {
    const connectedCids = new Set<string>();
    for (const sessionId of this.occupied.keys()) {
      const cid = this.clientIds.get(sessionId);
      if (cid) connectedCids.add(cid);
    }
    const reserved = new Set<number>();
    for (const [cid, seat] of this.seatByClient) {
      if (!connectedCids.has(cid)) reserved.add(seat);
    }

    const available: number[] = [];
    for (let s = 0; s < MAX_SEATS; s++) {
      if (!reserved.has(s)) available.push(s);
    }

    const humanEntries = [...this.occupied.entries()];
    const newOccupied = new Map<string, number>();
    const newNicknames = new Map<number, string>();
    humanEntries.forEach(([sessionId, oldSeat], i) => {
      const seat = available[i] ?? i;
      newOccupied.set(sessionId, seat);
      newNicknames.set(
        seat,
        this.nicknames.get(oldSeat) ?? `Jogador ${seat + 1}`,
      );
      const cid = this.clientIds.get(sessionId);
      if (cid) this.seatByClient.set(cid, seat);
    });

    this.occupied = newOccupied;
    this.nicknames = newNicknames;
    this.freeSeats = [];
    const taken = new Set(newOccupied.values());
    for (let s = 0; s < MAX_SEATS; s++) {
      if (!taken.has(s)) this.freeSeats.push(s);
    }
  }

  // -- setNickname ------------------------------------------------------

  private handleSetNickname(client: Client, message: unknown): void {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const parsed = validateSetNickname(message);
    if (!parsed) return; // payload inválido → ignora, estado inalterado

    this.nicknames.set(seat, parsed.nickname);
    this.broadcastSnapshots([]);
  }

  // -- handleChat --------------------------------------------------------
  private handleChat(client: Client, message: unknown): void {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const now = Date.now();
    const last = this.lastChatTime.get(client.sessionId) ?? 0;
    if (now - last < 2000) {
      logger.warn({ seat }, "Chat rate limit hit");
      return;
    }

    const parsed = validateChat(message);
    if (!parsed) return;

    this.lastChatTime.set(client.sessionId, now);
    this.pushSocial({ kind: "chat", t: now, seat, text: parsed.text });
  }

  // -- handleEmote -------------------------------------------------------
  private handleEmote(client: Client, message: unknown): void {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const now = Date.now();
    const last = this.lastEmoteTime.get(client.sessionId) ?? 0;
    if (now - last < 1500) {
      logger.warn({ seat }, "Emote rate limit hit");
      return;
    }

    const parsed = validateEmote(message);
    if (!parsed) return;

    this.lastEmoteTime.set(client.sessionId, now);
    this.pushSocial({ kind: "emote", t: now, seat, emoji: parsed.emoji });
  }

  // -- handleThrowTomato -------------------------------------------------
  private handleThrowTomato(client: Client, message: unknown): void {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const now = Date.now();
    const last = this.lastTomatoTime.get(client.sessionId) ?? 0;
    if (now - last < 3000) {
      logger.warn({ seat }, "Tomato rate limit hit");
      return;
    }

    const parsed = validateThrowTomato(message);
    if (!parsed) return;

    this.lastTomatoTime.set(client.sessionId, now);
    this.pushSocial({
      kind: "tomato",
      t: now,
      senderSeat: seat,
      targetSeat: parsed.targetSeat,
    });
  }

  // -- handleAction -----------------------------------------------------

  private handleAction(client: Client, message: unknown): void {
    const msg = message as Record<string, unknown> | null | undefined;

    // Valida envelope da mensagem (sempre, antes de status).
    if (!msg || typeof msg !== "object" || !("payload" in msg)) {
      this.rejectAction(client, "malformedPayload");
      return;
    }

    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) {
      this.rejectAction(client, "malformedPayload");
      return;
    }

    // Valida ação contra schema (sempre, antes de status).
    const action = validateAction(msg.payload);
    if (!action) {
      this.rejectAction(client, "malformedPayload");
      return;
    }

    if (this.closing) {
      this.rejectAction(client, "roomNotReady");
      return;
    }

    if (this.status !== "playing") {
      this.rejectAction(client, "roomNotReady");
      return;
    }

    // Verifica que não é seat de bot.
    if (this.botSeats.has(seat)) {
      this.rejectAction(client, "notYourTurn");
      return;
    }

    const result = this.match.dispatch(seat as Seat, action);
    if (!result.success) {
      this.rejectAction(client, result.error);
      return;
    }

    if (this.match.state().phase === "matchFinished") {
      this.status = "finished";
      this.setState({ status: this.status });
    }

    this.broadcastSnapshots(result.events);

    // Agenda dispatch do próximo bot, se for o caso.
    this.scheduleBotTurn(
      hasHoldEvent(result.events)
        ? BOT_DELAY_AFTER_VAZA_OR_HAND_MS
        : BOT_DELAY_MS,
    );
  }

  // -- Bot dispatch -----------------------------------------------------

  /**
   * Agenda o próximo dispatch de bot com preferência humana em decisões de
   * equipe (truco / mão de onze). Jogada de carta tem ator único; decisões
   * de equipe só disparam bot se nenhum humano elegível estiver conectado.
   */
  private scheduleBotTurn(delayMs: number = BOT_DELAY_MS): void {
    if (this.botDispatching) return;
    if (this.status !== "playing") return;
    if (this.closing) return;
    if (this.occupied.size === 0) return; // D-sala-2: sem humano, partida congela

    const st = this.match.state();
    const hand = st.hand;
    if (!hand || st.phase === "matchFinished") return;

    // Caso 1: decisão de onze → time decide, prefere humano.
    if (st.phase === "elevenDecision") {
      const elevenTeam: 0 | 1 = st.scores[0] === 11 ? 0 : 1;
      if (this.hasHumanOnTeam(elevenTeam)) return;
      const botSeat = this.firstBotOnTeam(elevenTeam);
      if (botSeat !== null) this.dispatchBotAction(botSeat as Seat, delayMs);
      return;
    }

    // Caso 2: truco pendente → só um seat responde (o engine escolhe qual),
    // então não há preferência humana a aplicar: se o responder é bot, ele age.
    if (hand.trucoPendingTeam !== null) {
      const responder = this.trucoResponderSeat();
      if (responder === null || !this.botSeats.has(responder)) return;
      this.dispatchBotAction(responder as Seat, delayMs);
      return;
    }

    // Caso 3: jogada de carta → ator único.
    const turnSeat = this.currentTurnSeat();
    if (turnSeat === null) return;
    if (!this.botSeats.has(turnSeat)) return;
    this.dispatchBotAction(turnSeat as Seat, delayMs);
  }

  /** Dispara ação do bot com delay e armazena o timer para limpeza. */
  private dispatchBotAction(
    botSeat: Seat,
    delayMs: number = BOT_DELAY_MS,
  ): void {
    this.botDispatching = true;

    this.botTimerId = setTimeout(() => {
      this.botTimerId = null;
      this.botDispatching = false;
      if (this.closing || this.status !== "playing") return;
      if (this.occupied.size === 0) return;
      if (!this.botSeats.has(botSeat)) return;
      if (this.isTeamDecisionReservedForHuman(botSeat)) return;

      const botView = this.match.playerView(botSeat);
      const botAction = decideBotAction(botView);

      if (!botAction) return;

      const result = this.match.dispatch(botSeat, botAction);
      if (!result.success) {
        // Se o bot falhou (não deveria), tenta de novo.
        this.scheduleBotTurn();
        return;
      }

      if (this.match.state().phase === "matchFinished") {
        this.status = "finished";
        this.setState({ status: this.status });
      }

      this.broadcastSnapshots(result.events);

      // Próximo bot na fila.
      this.scheduleBotTurn(
        hasHoldEvent(result.events)
          ? BOT_DELAY_AFTER_VAZA_OR_HAND_MS
          : BOT_DELAY_MS,
      );
    }, delayMs);
  }

  /** Cancela o timer pendente de bot sem alterar botDispatching. */
  private clearBotTimer(): void {
    if (this.botTimerId !== null) {
      clearTimeout(this.botTimerId);
      this.botTimerId = null;
    }
  }

  /** Cancela o dispatch pendente E libera o latch — esquecer o latch trava o bot. */
  private pauseBots(): void {
    this.clearBotTimer();
    this.botDispatching = false;
  }

  /** Arma o descarte. `ms` só é passado nos testes. */
  private armEmptyTimer(ms: number = EMPTY_ROOM_TTL_MS): void {
    this.clearEmptyTimer();
    this.emptyTimerId = setTimeout(() => {
      this.emptyTimerId = null;
      if (this.closing) return;
      if (this.occupied.size > 0) return;
      this.closing = true;
      this.clearBotTimer();
      void this.disconnect().catch((error: unknown) => {
        logger.error(error, "Failed to close idle TrucoRoom");
      });
    }, ms);
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimerId !== null) {
      clearTimeout(this.emptyTimerId);
      this.emptyTimerId = null;
    }
  }

  /** Chamar no fim de TODA saída: sem humano conectado, começa a contagem. */
  private armEmptyTimerIfEmpty(): void {
    if (this.occupied.size === 0) this.armEmptyTimer();
  }

  /** Slug legível e livre; cai no id do Colyseus se as 10 tentativas colidirem. */
  private pickRoomCode(): string {
    for (let i = 0; i < 10; i++) {
      const code = generateRoomCode((n: number) => randomInt(n));
      if (!matchMaker.getLocalRoomById(code)) return code;
    }
    return this.roomId;
  }

  private clientIdOf(client: Client): string {
    return (
      this.clientIds.get(client.sessionId) ??
      (client.userData as { clientId?: string } | undefined)?.clientId ??
      client.sessionId
    );
  }

  /** Dono efetivo: o criador se estiver conectado; senão, o humano mais antigo. */
  private effectiveOwnerClientId(): string | null {
    const connected: string[] = [];
    for (const sessionId of this.occupied.keys()) {
      connected.push(this.clientIds.get(sessionId) ?? sessionId);
    }
    if (this.ownerClientId && connected.includes(this.ownerClientId)) {
      return this.ownerClientId;
    }
    return connected[0] ?? null;
  }

  private isOwnerClient(client: Client): boolean {
    const owner = this.effectiveOwnerClientId();
    return owner !== null && this.clientIdOf(client) === owner;
  }

  /** Existe pelo menos um humano conectado no time? */
  private hasHumanOnTeam(team: 0 | 1): boolean {
    for (const [, seat] of this.occupied) {
      if (seat === 0 || seat === 2) {
        if (team === 0 && !this.botSeats.has(seat)) return true;
      } else {
        if (team === 1 && !this.botSeats.has(seat)) return true;
      }
    }
    return false;
  }

  /**
   * Só a mão de onze é decisão de time (os dois seats recebem a ação legal) e
   * portanto fica reservada ao humano. A resposta ao truco tem um único
   * responder definido pelo engine — reservá-la travaria a mão quando o
   * responder é bot e o parceiro é humano.
   */
  private isTeamDecisionReservedForHuman(botSeat: Seat): boolean {
    const state = this.match.state();
    if (state.phase !== "elevenDecision") return false;
    const team: 0 | 1 = state.scores[0] === 11 ? 0 : 1;
    return this.seatTeam(botSeat) === team && this.hasHumanOnTeam(team);
  }

  /** Seat que o engine designou para responder ao truco pendente. */
  private trucoResponderSeat(): number | null {
    for (let s = 0; s < MAX_SEATS; s++) {
      const v = this.match.playerView(s as Seat);
      if (v.legalActions.some((a) => a.type === "truco")) return s;
    }
    return null;
  }

  private seatTeam(seat: Seat): 0 | 1 {
    return seat === 0 || seat === 2 ? 0 : 1;
  }

  /** Primeiro bot no time (seat 0/2 para team 0, 1/3 para team 1). */
  private firstBotOnTeam(team: 0 | 1): number | null {
    const candidates = team === 0 ? [0, 2] : [1, 3];
    for (const s of candidates) {
      if (this.botSeats.has(s)) return s;
    }
    return null;
  }

  /**
   * Determina o seat do jogador cuja vez é agora, consultando todos os seats.
   */
  private currentTurnSeat(): number | null {
    for (let s = 0; s < MAX_SEATS; s++) {
      const v = this.match.playerView(s as Seat);

      // Se tem vaza em progresso e currentSeat aponta para este seat.
      if (v.currentVaza && v.currentVaza.currentSeat === s) {
        return s;
      }

      // Se não tem vaza e este seat pode jogar carta (nextStarter).
      // Ferro usa playHiddenCard (índice opaco); fora de ferro usa playCard.
      if (
        !v.currentVaza &&
        v.legalActions.some(
          (a) => a.type === "playCard" || a.type === "playHiddenCard",
        )
      ) {
        return s;
      }
    }
    return null;
  }

  // -- Helpers de mensagem ----------------------------------------------

  private rejectAction(client: Client, error: WireError): void {
    client.send("actionRejected", { error });
  }

  // -- Broadcast -------------------------------------------------------

  private broadcastSnapshots(events: readonly GameEvent[]): void {
    const t = Date.now();
    for (const e of events) this.log.push({ kind: "event", t, event: e });
    // ponytail: partida de 12 tentos não passa de ~400 linhas; corta as antigas.
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    }
    // Conselho antes do envio: entra no mesmo snapshot (não só no próximo).
    this.maybeAdvise();
    for (const c of this.clients) {
      const seat = this.occupied.get(c.sessionId);
      if (seat !== undefined) {
        this.sendSnapshot(c, seat, events);
      }
    }
  }

  /**
   * Registra no histórico e reenvia snapshots (o log vai neles).
   * Cuidado: maybeAdvise chama pushSocial → broadcastSnapshots de novo;
   * lastAdviceKey (setado antes do broadcast) corta a segunda passada.
   */
  private pushSocial(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    }
    if (entry.kind === "chat")
      this.broadcast("chatMessage", { seat: entry.seat, text: entry.text });
    else if (entry.kind === "emote")
      this.broadcast("emote", { seat: entry.seat, emoji: entry.emoji });
    else if (entry.kind === "tomato")
      this.broadcast("tomatoThrown", {
        senderSeat: entry.senderSeat,
        targetSeat: entry.targetSeat,
      });
    this.broadcastSnapshots([]);
  }

  /**
   * Publica no chat a opinião do bot parceiro quando o humano precisa
   * decidir truco ou mão de onze. Espelha os casos de scheduleBotTurn,
   * mas escolhe quem fala em vez de quem age.
   */
  private maybeAdvise(): void {
    if (this.status !== "playing") return;
    const st = this.match.state();
    if (!st.hand) return;

    let team: 0 | 1;
    let key: string;
    if (st.phase === "elevenDecision") {
      team = st.scores[0] === 11 ? 0 : 1;
      key = `${st.handNumber}:onze`;
    } else if (st.hand.trucoPendingTeam !== null) {
      team = st.hand.trucoPendingTeam === 0 ? 1 : 0;
      key = `${st.handNumber}:${st.hand.trucoPendingValue}`;
    } else {
      return;
    }

    if (!this.hasHumanOnTeam(team)) return;
    const botSeat = this.firstBotOnTeam(team);
    if (botSeat === null) return;
    // Se quem responde é o próprio bot, ele age — conselho seria ruído.
    if (
      st.hand.trucoPendingTeam !== null &&
      this.trucoResponderSeat() === botSeat
    )
      return;
    if (this.lastAdviceKey === key) return;
    this.lastAdviceKey = key;

    const text = botAdvice(this.match.playerView(botSeat as Seat));
    if (text) {
      this.pushSocial({ kind: "chat", t: Date.now(), seat: botSeat, text });
    }
  }

  private sendSnapshot(
    client: Client,
    seat: number,
    events: readonly GameEvent[],
  ): void {
    const connectedPlayers = this.occupied.size + this.botSeats.size;
    const m = this.match;

    const nicknamesRecord: Record<number, string> = {};
    for (const [s, name] of this.nicknames) {
      nicknamesRecord[s] = name;
    }

    const snapshot: SnapshotMessage = {
      type: "snapshot",
      seat,
      status: this.status,
      connectedPlayers,
      isOwner: this.isOwnerClient(client),
      metadata: {
        rulesetName: m.metadata.rulesetName,
        rulesetVersion: m.metadata.rulesetVersion,
        prngVersion: PRNG_VERSION,
      },
      nicknames: nicknamesRecord,
      botSeats: [...this.botSeats],
      // ponytail: manda o log inteiro em cada snapshot (~30KB no fim de uma
      // partida longa). Se o tráfego incomodar, mandar só a cauda com índice.
      log: [...this.log],
    };

    if (this.status === "playing" || this.status === "finished") {
      snapshot.view = m.playerView(seat as Seat);
    }

    if (this.status === "finished") {
      snapshot.replayMetadata = { ...m.metadata };
    }

    if (events.length > 0) {
      snapshot.events = [...events];
    }

    client.send("snapshot", snapshot);
  }
}
