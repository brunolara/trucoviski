/* ------------------------------------------------------------------ */
/*  TrucoRoom – sala Colyseus para 4 jogadores (F3: bots + nicknames)  */
/* ------------------------------------------------------------------ */

import { Room, type Client } from "colyseus";
import { randomInt } from "node:crypto";
import { createMatch, paulista } from "@trucoviski/engine";
import { PRNG_VERSION } from "@trucoviski/engine";
import type { Seat, GameEvent } from "@trucoviski/engine";
import {
  validateAction,
  validateSetNickname,
  validateChat,
  validateEmote,
  validateThrowTomato,
  validateShowCard,
} from "@trucoviski/shared";
import type { SnapshotMessage, WireError } from "@trucoviski/shared";
import { decideBotAction } from "@trucoviski/bots";
import { logger } from "./logger.js";

// ---- Constantes ------------------------------------------------------

const MAX_SEATS = 4;
const BOT_DELAY_MS = 1000;
const BOT_DELAY_AFTER_VAZA_OR_HAND_MS = 2000;

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

  // -- Lifecycle -------------------------------------------------------

  override onCreate(options: Record<string, unknown>): void {
    const seed = validateSeed(options.seed);
    this.match = createMatch(paulista, seed);
    this.setState({ status: this.status });

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
        ? options.nickname.trim().slice(0, 16)
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

    if (type === "showCard") {
      this.handleShowCard(client, message);
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

    for (const seat of seatsToFill) {
      this.botSeats.add(seat);
      this.nicknames.set(seat, `Bot ${seat + 1}`);

      // Remove do freeSeats (marcando como ocupado).
      const idx = this.freeSeats.indexOf(seat);
      if (idx !== -1) this.freeSeats.splice(idx, 1);
    }

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
    this.broadcast("chatMessage", { seat, text: parsed.text });
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
    this.broadcast("emote", { seat, emoji: parsed.emoji });
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
    this.broadcast("tomatoThrown", {
      senderSeat: seat,
      targetSeat: parsed.targetSeat,
    });
  }

  // -- handleShowCard ----------------------------------------------------
  private handleShowCard(client: Client, message: unknown): void {
    const seat = this.occupied.get(client.sessionId);
    if (seat === undefined) return;
    if (this.status !== "playing") return;

    const parsed = validateShowCard(message);
    if (!parsed) return;

    const h = this.match.state().hand;
    if (!h) return;

    const cards = h.cards[seat];
    if (!cards || parsed.cardIndex < 0 || parsed.cardIndex >= cards.length)
      return;

    const card = cards[parsed.cardIndex];
    if (!card) return;

    this.broadcast("cardShown", { seat, card });
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
    for (const c of this.clients) {
      const seat = this.occupied.get(c.sessionId);
      if (seat !== undefined) {
        this.sendSnapshot(c, seat, events);
      }
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
