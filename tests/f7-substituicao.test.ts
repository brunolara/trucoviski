/* ------------------------------------------------------------------ */
/*  Testes de substituição de humano por bot, reconexão e anti-cheat  */
/*  Fase F7 - Trucoviski                                              */
/* ------------------------------------------------------------------ */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";
import { createMatch } from "@trucoviski/engine";
import { decideBotAction } from "../packages/bots/src/index.js";
import type { SnapshotMessage, PlayerView, Seat } from "@trucoviski/shared";

// ---- Types & Helpers ------------------------------------------------

interface ConnectedClient {
  raw: Awaited<ReturnType<ColyseusTestServer["connectTo"]>>;
  messages: { type: string; payload: unknown }[];
}

interface TrucoRoomInternal {
  status: "waiting" | "playing" | "finished";
  closing: boolean;
  occupied: Map<string, number>;
  botSeats: Set<number>;
  match: ReturnType<typeof createMatch>;
  scheduleBotTurn: (delayMs?: number) => void;
}

async function connectWithQueue(
  gameServer: ColyseusTestServer,
  room: Awaited<ReturnType<ColyseusTestServer["createRoom"]>>,
  options?: Record<string, unknown>,
): Promise<ConnectedClient> {
  const raw = await gameServer.connectTo(room, options);
  const messages: { type: string; payload: unknown }[] = [];
  raw.onMessage("*", (type: string | number, payload: unknown) => {
    messages.push({ type: String(type), payload });
  });
  return { raw, messages };
}

async function reconnectWithQueue(
  gameServer: ColyseusTestServer,
  reconnectionToken: string,
): Promise<ConnectedClient> {
  const raw = await gameServer.sdk.reconnect(reconnectionToken);
  const messages: { type: string; payload: unknown }[] = [];
  raw.onMessage("*", (type: string | number, payload: unknown) => {
    messages.push({ type: String(type), payload });
  });
  return { raw, messages };
}

async function waitForInQueue(
  client: ConnectedClient,
  type: string,
  timeoutMs = 5000,
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = client.messages.findIndex((m) => m.type === type);
    if (idx !== -1) {
      const [msg] = client.messages.splice(idx, 1);
      return msg?.payload;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timeout waiting for "${type}"`);
}

function drainAll(client: ConnectedClient): void {
  client.messages.length = 0;
}

async function syncAndWait(client: ConnectedClient): Promise<SnapshotMessage> {
  client.raw.send("sync", {});
  const payload = await waitForInQueue(client, "snapshot");
  return payload as SnapshotMessage;
}

async function drainJoinSnapshots(clients: ConnectedClient[]): Promise<void> {
  for (const c of clients) {
    await waitForInQueue(c, "snapshot");
  }
}

async function pollCondition(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timeout polling condition");
}

function assertInvariants(
  room: TrucoRoomInternal,
  snap?: SnapshotMessage,
): void {
  // Invariante 1: occupied e botSeats nunca compartilham assento
  const occupiedSeats = new Set(room.occupied.values());
  for (const botSeat of room.botSeats) {
    expect(occupiedSeats.has(botSeat)).toBe(false);
  }

  // Invariante 2: connectedPlayers no snapshot sempre entre 0 e 4
  if (snap) {
    expect(snap.connectedPlayers).toBeGreaterThanOrEqual(0);
    expect(snap.connectedPlayers).toBeLessThanOrEqual(4);
    expect(snap.connectedPlayers).toBe(room.occupied.size + room.botSeats.size);
  }
}

/**
 * Dirige uma partida real (engine determinística da própria sala) até
 * Ferro 11×11 via dispatches legais. Mesmo driver de f5-engine.test.ts:
 * o primeiro assento com ação legal age; truco é sempre aceito; decisão de
 * onze é sempre "play". Lança erro se a partida terminar antes do ferro.
 */
function driveToFerro(match: ReturnType<typeof createMatch>): void {
  let safety = 0;
  while (safety < 1000) {
    const s = match.state();
    if (s.phase === "matchFinished") {
      throw new Error(
        `match finished at ${JSON.stringify(s.scores)} before reaching ferro`,
      );
    }
    if (s.hand?.isFerro) return;

    let acted = false;
    for (let seat = 0; seat < 4; seat++) {
      const view = match.playerView(seat as Seat);
      const action =
        view.legalActions.find((a) => a.type === "playCard") ??
        view.legalActions.find((a) => a.type === "elevenDecision") ??
        view.legalActions.find(
          (a) => a.type === "truco" && a.action === "accept",
        );
      if (action) {
        const r = match.dispatch(seat as Seat, action);
        if (!r.success) {
          throw new Error(
            `unexpected rejection "${r.error}" for ${JSON.stringify(action)} at seat ${seat}`,
          );
        }
        acted = true;
        break;
      }
    }
    if (!acted) {
      throw new Error(
        `no legal actor at hand ${match.state().handNumber} (phase ${match.state().phase})`,
      );
    }
    safety++;
  }
  throw new Error("driveToFerro: safety limit exceeded");
}

// ---- Compliance Inspector de Anti-Cheat (Raw Payload Inspection) ----

interface AntiCheatViolation {
  reason: string;
  payload: unknown;
}

function checkSnapshotAntiCheat(snap: SnapshotMessage): AntiCheatViolation[] {
  const violations: AntiCheatViolation[] = [];
  const jsonStr = JSON.stringify(snap);
  const json = JSON.parse(jsonStr) as Record<string, unknown>;

  // 1. Não pode expor o objeto de estado interno (MatchState / engine state)
  if (json.state !== undefined) {
    violations.push({
      reason: "Exposta propriedade 'state' no root",
      payload: snap,
    });
  }

  const view = snap.view;
  if (!view) return violations;

  // 2. Não pode expor 'cards' (array interno de 4 mãos)
  if ((view as unknown as Record<string, unknown>).cards !== undefined) {
    violations.push({
      reason: "Exposta propriedade 'cards' no view",
      payload: snap,
    });
  }

  // 3. partnerCards é permitido APENAS na mão de onze não-ferro.
  //    O SnapshotMessage não tem campo phase; a fase real vem do PlayerView:
  //    a engine (match.ts) só preenche partnerCards quando o hand é
  //    isElevenHand && !isFerro e o time do cliente tem 11.
  const elevenNonFerro = view.isElevenHand === true && view.isFerro === false;
  if (view.partnerCards && view.partnerCards.length > 0 && !elevenNonFerro) {
    violations.push({
      reason: `partnerCards visível fora da mão de onze não-ferro (isElevenHand: ${String(view.isElevenHand)}, isFerro: ${String(view.isFerro)})`,
      payload: snap,
    });
  }

  // 4. Mão privada do cliente (handCards) não pode ter mais de 3 cartas
  if (view.handCards && view.handCards.length > 3) {
    violations.push({
      reason: `handCards contém mais de 3 cartas (${view.handCards.length})`,
      payload: snap,
    });
  }

  return violations;
}

// ---- Test Suite -----------------------------------------------------

describe("F7 - Substituição de Humano por Bot & Reconexão", () => {
  let gameServer: ColyseusTestServer;
  const SEED = 12345;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  /** Helper para setup de sala com 2 humanos (seats 0, 1) + 2 bots (seats 2, 3) */
  async function setup2Humans2Bots(seed = SEED) {
    const room = await gameServer.createRoom("truco", { seed });
    const c1 = await connectWithQueue(gameServer, room);
    const c2 = await connectWithQueue(gameServer, room);
    await drainJoinSnapshots([c1, c2]);

    // Dono (c1) chama fillBots e startGame
    c1.raw.send("fillBots", {});
    c1.raw.send("startGame", {});

    // Aguarda sala ficar "playing" para ambos
    await pollCondition(async () => {
      const s1 = await syncAndWait(c1);
      const s2 = await syncAndWait(c2);
      return s1.status === "playing" && s2.status === "playing";
    });

    drainAll(c1);
    drainAll(c2);

    const internalRoom = room as unknown as TrucoRoomInternal;
    return { room, internalRoom, c1, c2 };
  }

  // -------------------------------------------------------------------
  // Caso A: Queda involuntária mantém sala e jogo avança
  // -------------------------------------------------------------------
  it("Caso A: 2 humanos + 2 bots; queda involuntária de 1 humano não fecha sala, humano restante recebe snapshots e jogo avança", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 1);

    const snap1Before = await syncAndWait(c1);
    const snap2Before = await syncAndWait(c2);
    expect(snap1Before.seat).toBe(0);
    expect(snap2Before.seat).toBe(1);
    assertInvariants(internalRoom, snap1Before);

    // Human 2 (seat 1) cai involuntariamente
    c2.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));

    // Sala NÃO fecha
    expect(internalRoom.closing).toBe(false);
    expect(internalRoom.status).toBe("playing");

    // Invariante: assento 1 agora está em botSeats
    assertInvariants(internalRoom);
    expect(internalRoom.botSeats.has(1)).toBe(true);
    expect(internalRoom.occupied.has(c2.raw.sessionId)).toBe(false);

    // Humano restante (c1) continua conectado e recebendo snapshots
    expect(c1.raw.connection.isOpen).toBe(true);

    // O humano restante (c1) faz sua jogada quando for a vez dele; a
    // evidência do jogo avançar é o assento substituído (1, agora bot)
    // jogar uma carta — não apenas "receber snapshots".
    let replacedSeatActed = false;
    await pollCondition(async () => {
      for (const m of c1.messages) {
        if (m.type === "snapshot") {
          const snap = m.payload as SnapshotMessage;
          assertInvariants(internalRoom, snap);
          if (
            snap.events?.some((e) => e.type === "cardPlayed" && e.seat === 1)
          ) {
            replacedSeatActed = true;
            return true;
          }
        }
      }
      // Se for a vez do humano, joga para o jogo fluir até o bot agir.
      const snap = await syncAndWait(c1);
      assertInvariants(internalRoom, snap);
      const playAct = snap.view?.legalActions.find(
        (a) => a.type === "playCard",
      );
      if (playAct) {
        c1.raw.send("action", { payload: playAct });
        await waitForInQueue(c1, "snapshot");
      }
      return false;
    }, 10000);

    expect(replacedSeatActed).toBe(true);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso B: Reconexão dentro da janela restaura o assento e controle
  // -------------------------------------------------------------------
  it("Caso B: Reconexão dentro da janela restaura mesmo assento, aceita ações e impede bot de jogar por ele", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 2);

    const snap2 = await syncAndWait(c2);
    const originalSeat = snap2.seat;
    expect(originalSeat).toBe(1);

    const reconnectToken = c2.raw.reconnectionToken;
    expect(reconnectToken).toBeTruthy();

    // Queda involuntária
    c2.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(internalRoom.botSeats.has(originalSeat)).toBe(true);

    // Reconecta com o token via SDK
    const c2Reconnected = await reconnectWithQueue(gameServer, reconnectToken);

    // Drena snapshot de entrada da reconexão
    const reconSnap = await syncAndWait(c2Reconnected);
    expect(reconSnap.seat).toBe(originalSeat);
    assertInvariants(internalRoom, reconSnap);

    // Assento não é mais bot
    expect(internalRoom.botSeats.has(originalSeat)).toBe(false);
    expect(internalRoom.occupied.get(c2Reconnected.raw.sessionId)).toBe(
      originalSeat,
    );

    // Garante que o jogo avança até c2Reconnected ter sua vez (se c1 precisar jogar primeiro)
    let actionAccepted = false;
    await pollCondition(async () => {
      const snap1 = await syncAndWait(c1);
      const playAct1 = snap1.view?.legalActions.find(
        (a) => a.type === "playCard",
      );
      if (playAct1) {
        c1.raw.send("action", { payload: playAct1 });
        await waitForInQueue(c1, "snapshot");
      }

      drainAll(c2Reconnected);
      const snap2Re = await syncAndWait(c2Reconnected);
      const playAct2 = snap2Re.view?.legalActions.find(
        (a) => a.type === "playCard",
      );
      if (playAct2) {
        c2Reconnected.raw.send("action", { payload: playAct2 });
        const res = (await waitForInQueue(
          c2Reconnected,
          "snapshot",
        )) as SnapshotMessage;
        expect(res).toBeDefined();
        actionAccepted = true;
        return true;
      }
      return false;
    }, 10000);

    expect(actionAccepted).toBe(true);
    assertInvariants(internalRoom);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso C: Queda na vez exata do jogador destrava mesa via scheduleBotTurn
  // -------------------------------------------------------------------
  it("Caso C: Queda na vez exata do jogador aciona scheduleBotTurn e destrava a mesa", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 3);

    // Avança se necessário até ser a vez de c2 (seat 1)
    let c2IsTurn = false;
    await pollCondition(async () => {
      const s2 = await syncAndWait(c2);
      if (s2.view?.legalActions.some((a) => a.type === "playCard")) {
        c2IsTurn = true;
        return true;
      }
      // Se for a vez de c1, c1 joga para passar o turno para c2
      const s1 = await syncAndWait(c1);
      const play1 = s1.view?.legalActions.find((a) => a.type === "playCard");
      if (play1) {
        c1.raw.send("action", { payload: play1 });
        await waitForInQueue(c1, "snapshot");
      }
      return false;
    }, 8000);

    expect(c2IsTurn).toBe(true);

    // C2 cai exatamente na sua vez!
    c2.raw.leave(false);

    // Sem scheduleBotTurn(), a mesa congelaria aguardando ação.
    // Com scheduleBotTurn(), o bot joga dentro do deadline (BOT_DELAY_MS = 1000ms).
    // Inspeciona os broadcast snapshots que chegam em c1.messages sem dar drainAll.
    let botTookTurn = false;
    await pollCondition(async () => {
      for (const m of c1.messages) {
        if (m.type === "snapshot") {
          const snap = m.payload as SnapshotMessage;
          assertInvariants(internalRoom, snap);
          const cardPlayedEvent = snap.events?.find(
            (e) => e.type === "cardPlayed" && e.seat === 1,
          );
          if (cardPlayedEvent) {
            botTookTurn = true;
            return true;
          }
        }
      }
      // Também verifica se a vaza atual já registrou a carta de seat 1
      const snapSync = await syncAndWait(c1);
      assertInvariants(internalRoom, snapSync);
      if (snapSync.view?.currentVaza?.plays[1] !== null) {
        botTookTurn = true;
        return true;
      }
      return false;
    }, 8000);

    expect(botTookTurn).toBe(true);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso D: Último humano cai → fail-closed preservado (sala fecha)
  // -------------------------------------------------------------------
  it("Caso D: Último humano cai → sala fecha (fail-closed, nunca existe sala só de bots)", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 4);

    // Primeiro humano cai
    c1.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(internalRoom.closing).toBe(false);

    // Segundo (último) humano cai
    c2.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));

    // Sala inicia encerramento
    expect(internalRoom.closing).toBe(true);
    expect(internalRoom.occupied.size).toBe(0);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso E: Saída voluntária (leave, 1000) substitui por bot sem reserva
  // -------------------------------------------------------------------
  it("Caso E: Saída voluntária vira bot, sala sobrevive e não há reserva de assento", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 5);

    const c2Token = c2.raw.reconnectionToken;

    // Saída voluntária (consented = true)
    c2.raw.leave(true);
    await new Promise((r) => setTimeout(r, 100));

    // Sala sobrevive
    expect(internalRoom.closing).toBe(false);
    expect(internalRoom.status).toBe("playing");
    expect(internalRoom.botSeats.has(1)).toBe(true);

    // Tentativa de reconexão com token deve falhar / ser rejeitada
    await expect(reconnectWithQueue(gameServer, c2Token)).rejects.toThrow();

    // Humano 1 continua jogando com o bot no assento 1
    const s1 = await syncAndWait(c1);
    expect(s1.status).toBe("playing");
    assertInvariants(internalRoom, s1);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso F: Anti-cheat em todas as fases da substituição
  // -------------------------------------------------------------------
  it("Caso F: Anti-cheat — inspeção de payloads brutos antes, durante e depois da substituição", async () => {
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(SEED + 6);

    const violations: AntiCheatViolation[] = [];

    function inspect(client: ConnectedClient) {
      for (const m of client.messages) {
        if (m.type === "snapshot") {
          const v = checkSnapshotAntiCheat(m.payload as SnapshotMessage);
          violations.push(...v);
        }
      }
    }

    // 1. Antes da substituição
    await syncAndWait(c1);
    await syncAndWait(c2);
    inspect(c1);
    inspect(c2);

    // 2. Durante a substituição (c2 cai involuntariamente)
    const token = c2.raw.reconnectionToken;
    c2.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));

    drainAll(c1);
    await syncAndWait(c1);
    inspect(c1);

    // 3. Depois da reconexão
    const c2Re = await reconnectWithQueue(gameServer, token);
    await syncAndWait(c2Re);
    inspect(c2Re);

    drainAll(c1);
    await syncAndWait(c1);
    inspect(c1);

    // Prova que nenhuma carta alheia vazou
    expect(violations).toEqual([]);
    assertInvariants(internalRoom);
  }, 15000);

  // -------------------------------------------------------------------
  // Caso G: Ferro 11×11 com assento substituído
  // -------------------------------------------------------------------
  it("Caso G: Ferro 11×11 com assento substituído executa playHiddenCard sem travar (cobertura em nível Colyseus e Engine/Bot)", async () => {
    // --- Sub-caso G1: Nível Engine / Bots ---
    const ferroView: PlayerView = {
      mySeat: 1,
      handNumber: 1,
      scores: [11, 11],
      handCards: [],
      completedVazas: [],
      vira: { suit: "paus", rank: "4" },
      dealerSeat: 0,
      trucoValue: 3,
      trucoPendingTeam: null,
      trucoPendingValue: null,
      elevenDecision: null,
      currentVaza: {
        currentSeat: 1,
        plays: [null, null, null, null],
        covered: [false, false, false, false],
      },
      legalActions: [
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
        { type: "playHiddenCard", cardIndex: 2 },
      ],
      isElevenHand: false,
      isFerro: true,
      partnerCards: undefined,
    };

    const botAction = decideBotAction(ferroView);
    expect(botAction).not.toBeNull();
    expect(botAction?.type).toBe("playHiddenCard");

    // --- Sub-caso G2: Nível Sala Colyseus ---
    // A sala não aceita placar inicial; dirige-se a partida REAL da sala
    // (engine determinística) até Ferro 11×11 via dispatches. Seed 27
    // chega a 11×11 na mão 17 com dealer 0 (verificado com o mesmo driver).
    const { internalRoom, c1, c2 } = await setup2Humans2Bots(27);

    // Substitui c2 por bot via queda involuntária
    c2.raw.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(internalRoom.botSeats.has(1)).toBe(true);

    // Dirige a partida da sala até Ferro 11×11
    driveToFerro(internalRoom.match);
    expect(internalRoom.match.state().scores).toEqual([11, 11]);
    expect(internalRoom.match.state().hand?.isFerro).toBe(true);

    // Aciona a sala: se o turno do ferro cair num bot, ele age já; no seed
    // 27 o dealer da mão de ferro é o assento 0 (humano), então o poll
    // abaixo faz c1 jogar às cegas e o assento 1 (bot) age em seguida.
    internalRoom.scheduleBotTurn();

    // Polling até o bot do assento substituído jogar carta oculta (evento
    // cardPlayed vindo do assento 1), sem que a sala trave.
    let botPlayed = false;
    await pollCondition(async () => {
      for (const m of c1.messages) {
        if (m.type === "snapshot") {
          const snap = m.payload as SnapshotMessage;
          assertInvariants(internalRoom, snap);
          if (
            snap.events?.some((e) => e.type === "cardPlayed" && e.seat === 1)
          ) {
            botPlayed = true;
            return true;
          }
        }
      }
      // Se for a vez do humano no ferro, joga carta oculta (às cegas).
      const snap = await syncAndWait(c1);
      assertInvariants(internalRoom, snap);
      if (snap.view?.isFerro) {
        const hidden = snap.view.legalActions.find(
          (a) => a.type === "playHiddenCard",
        );
        if (hidden) {
          c1.raw.send("action", { payload: hidden });
          await waitForInQueue(c1, "snapshot");
        }
      }
      return false;
    }, 10000);

    expect(botPlayed).toBe(true);
    expect(internalRoom.closing).toBe(false);
  }, 15000);
});

// -------------------------------------------------------------------
// Anti-cheat: a regra de partnerCards derivada do PlayerView, testada
// diretamente nos dois sentidos (permite onze não-ferro, viola no ferro).
// -------------------------------------------------------------------
describe("F7 - Anti-cheat: partnerCards restrito à mão de onze não-ferro", () => {
  const base: SnapshotMessage = {
    type: "snapshot",
    seat: 0,
    status: "playing",
    connectedPlayers: 4,
    ownerSessionId: "owner",
    metadata: {
      rulesetName: "paulista",
      rulesetVersion: "1",
      prngVersion: "1",
    },
  };

  function makeView(partial: Partial<PlayerView>): PlayerView {
    return {
      handNumber: 12,
      mySeat: 0,
      dealerSeat: 1,
      handCards: [],
      vira: { suit: "copas", rank: "4" },
      completedVazas: [],
      currentVaza: null,
      scores: [11, 5],
      trucoValue: 3,
      trucoPendingTeam: null,
      trucoPendingValue: null,
      isElevenHand: true,
      isFerro: false,
      elevenDecision: null,
      legalActions: [{ type: "elevenDecision", decision: "play" }],
      ...partial,
    };
  }

  it("permite partnerCards na mão de onze não-ferro", () => {
    const snap: SnapshotMessage = {
      ...base,
      view: makeView({
        partnerCards: [{ suit: "paus", rank: "A" }],
      }),
    };
    expect(checkSnapshotAntiCheat(snap)).toEqual([]);
  });

  it("viola quando partnerCards aparece no ferro 11×11", () => {
    const snap: SnapshotMessage = {
      ...base,
      view: makeView({
        scores: [11, 11],
        isElevenHand: false,
        isFerro: true,
        elevenDecision: null,
        handCards: [],
        partnerCards: [{ suit: "paus", rank: "A" }],
        currentVaza: {
          currentSeat: 0,
          plays: [null, null, null, null],
          covered: [false, false, false, false],
        },
        legalActions: [{ type: "playHiddenCard", cardIndex: 0 }],
      }),
    };
    const violations = checkSnapshotAntiCheat(snap);
    expect(violations.some((v) => v.reason.includes("partnerCards"))).toBe(
      true,
    );
  });

  it("viola quando partnerCards aparece em mão comum (sem onze)", () => {
    const snap: SnapshotMessage = {
      ...base,
      view: makeView({
        scores: [5, 4],
        isElevenHand: false,
        isFerro: false,
        elevenDecision: null,
        partnerCards: [{ suit: "paus", rank: "A" }],
        legalActions: [
          {
            type: "playCard",
            card: { suit: "paus", rank: "A" },
          },
        ],
      }),
    };
    const violations = checkSnapshotAntiCheat(snap);
    expect(violations.some((v) => v.reason.includes("partnerCards"))).toBe(
      true,
    );
  });
});
