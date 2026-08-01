/* ------------------------------------------------------------------ */
/*  TrucoRoom – sala Colyseus para 4 jogadores (F3: bots + nicknames)  */
/* ------------------------------------------------------------------ */

import { Room, type Client } from "colyseus";
import { randomInt } from "node:crypto";
import { createMatch, paulista } from "@trucoviski/engine";
import { PRNG_VERSION } from "@trucoviski/engine";
import type { Seat, GameEvent, PlayerView } from "@trucoviski/engine";
import {
  NICKNAME_MAX_LENGTH,
  pickUniquePlayerNames,
  validateAction,
  validateSetNickname,
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
const BOT_DELAY_MS = 1000;
const BOT_DELAY_AFTER_VAZA_OR_HAND_MS = 2600;
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
  const action = decideBotAction(view);
  if (action?.type === "truco") return persona[action.action] ?? null;
  if (action?.type === "elevenDecision")
    return action.decision === "play" ? persona.play : persona.fold;
  return null;
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

  /** Dono da sala (primeiro a entrar). */
  private ownerSessionId: string | null = null;

  private match!: ReturnType<typeof createMatch>;

  private status: "waiting" | "playing" | "finished" = "waiting";

  /** Flag para impedir disconnect recursivo no fail-closed. */
  private closing = false;

  /** Flag para evitar dispatches concorrentes de bots. */
  private botDispatching = false;

  /** Timer ID do próximo dispatch de bot (para limpeza no dispose). */
  private botTimerId: ReturnType<typeof setTimeout> | null = null;

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

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, type, message);
    });
  }

  override onDispose(): void {
    this.clearBotTimer();
  }

  override onJoin(client: Client, options?: Record<string, unknown>): void {
    const seat = this.freeSeats.shift();
    if (seat === undefined) {
      client.leave();
      return;
    }

    this.occupied.set(client.sessionId, seat);

    // Registra nickname (F3).
    const nickname =
      typeof options?.nickname === "string" && options.nickname.trim()
        ? options.nickname.trim().slice(0, NICKNAME_MAX_LENGTH)
        : `Jogador ${seat + 1}`;
    this.nicknames.set(seat, nickname);

    // Dono da sala (primeiro a entrar).
    if (!this.ownerSessionId) {
      this.ownerSessionId = client.sessionId;
    }

    // Quarto ocupante (humano ou bot) → inicia partida, locka sala.
    if (this.occupied.size + this.botSeats.size === MAX_SEATS) {
      this.status = "playing";
      this.setState({ status: this.status });
      this.broadcastSnapshots([]);
      void this.lock();
      this.scheduleBotTurn();
    } else {
      // Ainda no lobby: notifica todos os presentes (novo jogador entrou).
      this.broadcastSnapshots([]);
    }
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;

    const consented = code === 1000 || code === 4000;

    if (this.status === "waiting") {
      this.occupied.delete(client.sessionId);
      this.nicknames.delete(seat);
      // Libera assento para próximo jogador.
      this.freeSeats.push(seat);
      this.freeSeats.sort((a, b) => a - b);

      // Se o dono saiu, promove o humano mais antigo restante.
      if (this.ownerSessionId === client.sessionId) {
        const [nextOwner] = this.occupied.keys();
        this.ownerSessionId = nextOwner ?? null;
      }

      this.broadcastSnapshots([]);
      return;
    }

    if (this.status === "playing") {
      const nickname = this.nicknames.get(seat) ?? `Jogador ${seat + 1}`;
      // A ordem mantém occupied e botSeats mutuamente exclusivos.
      this.occupied.delete(client.sessionId);
      if (this.occupied.size === 0) {
        if (this.closing) return;
        this.closing = true;
        this.clearBotTimer();
        queueMicrotask(() => {
          void this.disconnect().catch((error: unknown) => {
            logger.error(error, "Failed to close TrucoRoom after player left");
          });
        });
        return;
      }
      this.botSeats.add(seat);
      this.pushSocial({
        kind: "system",
        t: Date.now(),
        text: `${nickname} ${consented ? "saiu" : "caiu"} — bot assumiu.`,
      });
      this.scheduleBotTurn();

      // Saída voluntária não reserva o assento para reconexão.
      if (consented) return;

      try {
        const newClient = await this.allowReconnection(
          client,
          RECONNECT_SECONDS,
        );
        const newSessionId = newClient.sessionId;
        this.botSeats.delete(seat);
        this.occupied.set(newSessionId, seat);

        if (newSessionId !== client.sessionId) {
          if (this.ownerSessionId === client.sessionId) {
            this.ownerSessionId = newSessionId;
          }
          const chatT = this.lastChatTime.get(client.sessionId);
          if (chatT) this.lastChatTime.set(newSessionId, chatT);
          const emoteT = this.lastEmoteTime.get(client.sessionId);
          if (emoteT) this.lastEmoteTime.set(newSessionId, emoteT);
          const tomatoT = this.lastTomatoTime.get(client.sessionId);
          if (tomatoT) this.lastTomatoTime.set(newSessionId, tomatoT);
        }

        this.pushSocial({
          kind: "system",
          t: Date.now(),
          text: `${nickname} voltou.`,
        });
      } catch {
        // O bot permanece até o fim da partida.
      }
      return;
    }

    // Se o cliente saiu voluntariamente, finaliza a sala imediatamente.
    if (consented) {
      this.occupied.delete(client.sessionId);
      this.nicknames.delete(seat);

      if (this.closing) return;
      this.closing = true;
      this.clearBotTimer();
      queueMicrotask(() => {
        void this.disconnect().catch((error: unknown) => {
          logger.error(error, "Failed to close TrucoRoom after player left");
        });
      });
      return;
    }

    // Queda involuntária: aguarda reconexão por até 15 segundos
    try {
      const newClient = await this.allowReconnection(client, 15);

      const newSessionId = newClient.sessionId;
      // Atualiza os mapeamentos caso o sessionId tenha mudado
      if (newSessionId !== client.sessionId) {
        this.occupied.delete(client.sessionId);
        this.occupied.set(newSessionId, seat);

        if (this.ownerSessionId === client.sessionId) {
          this.ownerSessionId = newSessionId;
        }

        const chatT = this.lastChatTime.get(client.sessionId);
        if (chatT) this.lastChatTime.set(newSessionId, chatT);

        const emoteT = this.lastEmoteTime.get(client.sessionId);
        if (emoteT) this.lastEmoteTime.set(newSessionId, emoteT);

        const tomatoT = this.lastTomatoTime.get(client.sessionId);
        if (tomatoT) this.lastTomatoTime.set(newSessionId, tomatoT);
      }

      this.sendSnapshot(newClient, seat, []);
    } catch {
      // Cliente não reconectou a tempo: fail-closed
      this.occupied.delete(client.sessionId);
      this.nicknames.delete(seat);

      if (this.closing) return;
      this.closing = true;
      this.clearBotTimer();
      queueMicrotask(() => {
        void this.disconnect().catch((error: unknown) => {
          logger.error(
            error,
            "Failed to close TrucoRoom after reconnect timeout",
          );
        });
      });
    }
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

  // -- fillBots ---------------------------------------------------------

  private handleFillBots(client: Client): void {
    // Só o dono pode preencher.
    if (client.sessionId !== this.ownerSessionId) return;

    // Só no lobby (waiting).
    if (this.status !== "waiting") return;

    // Normaliza assentos: humanos (na ordem em que entraram) ocupam os
    // assentos mais baixos (0..N-1); bots preenchem o resto. Com 2 humanos
    // isso garante 1 humano por time (times são 0/2 vs 1/3).
    this.normalizeHumanSeats();

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

      // Remove do freeSeats (marcando como ocupado).
      const idx = this.freeSeats.indexOf(seat);
      if (idx !== -1) this.freeSeats.splice(idx, 1);
    });

    // Se todos os 4 seats estão ocupados (humanos + bots), inicia.
    if (this.occupied.size + this.botSeats.size === MAX_SEATS) {
      this.status = "playing";
      this.setState({ status: this.status });
      this.broadcastSnapshots([]);
      void this.lock();
      this.scheduleBotTurn();
    } else {
      this.broadcastSnapshots([]);
    }
  }

  /** Reatribui humanos aos assentos 0..N-1 (na ordem em que entraram). */
  private normalizeHumanSeats(): void {
    const humanEntries = [...this.occupied.entries()];

    const newOccupied = new Map<string, number>();
    const newNicknames = new Map<number, string>();
    humanEntries.forEach(([sessionId, oldSeat], i) => {
      newOccupied.set(sessionId, i);
      newNicknames.set(i, this.nicknames.get(oldSeat) ?? `Jogador ${i + 1}`);
    });

    this.occupied = newOccupied;
    this.nicknames = newNicknames;
    this.freeSeats = [];
    for (let s = humanEntries.length; s < MAX_SEATS; s++) {
      this.freeSeats.push(s);
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

    // Caso 2: truco pendente → time oposto responde, prefere humano.
    if (hand.trucoPendingTeam !== null) {
      const respondingTeam: 0 | 1 = hand.trucoPendingTeam === 0 ? 1 : 0;
      if (this.hasHumanOnTeam(respondingTeam)) return;
      const botSeat = this.firstBotOnTeam(respondingTeam);
      if (botSeat !== null) this.dispatchBotAction(botSeat as Seat, delayMs);
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

  /** Uma decisão de equipe pendente não pode ser tomada pelo bot se há aliado humano. */
  private isTeamDecisionReservedForHuman(botSeat: Seat): boolean {
    const state = this.match.state();
    if (state.phase === "elevenDecision") {
      const team: 0 | 1 = state.scores[0] === 11 ? 0 : 1;
      return this.seatTeam(botSeat) === team && this.hasHumanOnTeam(team);
    }

    const pendingTeam = state.hand?.trucoPendingTeam;
    if (pendingTeam === null || pendingTeam === undefined) return false;
    const team: 0 | 1 = pendingTeam === 0 ? 1 : 0;
    return this.seatTeam(botSeat) === team && this.hasHumanOnTeam(team);
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
      ownerSessionId: this.ownerSessionId ?? "",
      metadata: {
        rulesetName: m.metadata.rulesetName,
        rulesetVersion: m.metadata.rulesetVersion,
        prngVersion: PRNG_VERSION,
      },
      nicknames: nicknamesRecord,
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
