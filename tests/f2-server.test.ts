/* ------------------------------------------------------------------ */
/*  Testes do servidor Colyseus – F2 slice 1                           */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- snapshots validados com toBeDefined/toContain */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";
import { validateAction } from "@trucoviski/shared";
import type {
  Action,
  Card,
  SnapshotMessage,
  ActionRejectedMessage,
} from "@trucoviski/shared";

// ---- Helpers --------------------------------------------------------

interface ConnectedClient {
  raw: Awaited<ReturnType<ColyseusTestServer["connectTo"]>>;
  messages: { type: string; payload: unknown }[];
}

async function connectWithQueue(
  gameServer: ColyseusTestServer,
  room: Awaited<ReturnType<ColyseusTestServer["createRoom"]>>,
): Promise<ConnectedClient> {
  const raw = await gameServer.connectTo(room);
  const messages: { type: string; payload: unknown }[] = [];
  raw.onMessage("*", (type: string | number, payload: unknown) => {
    messages.push({ type: String(type), payload });
  });
  return { raw, messages };
}

async function connectNWithQueue(
  gameServer: ColyseusTestServer,
  room: Awaited<ReturnType<ColyseusTestServer["createRoom"]>>,
  n: number,
): Promise<ConnectedClient[]> {
  const clients: ConnectedClient[] = [];
  for (let i = 0; i < n; i++) {
    clients.push(await connectWithQueue(gameServer, room));
  }
  return clients;
}

async function waitForInQueue(
  client: ConnectedClient,
  type: string,
  timeoutMs = 3000,
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

/** Drena snapshots do onJoin (status waiting) para todos os clientes. */
async function drainJoinSnapshots(clients: ConnectedClient[]): Promise<void> {
  for (const c of clients) {
    await waitForInQueue(c, "snapshot"); // onJoin snapshot
  }
}

/**
 * Espera até a sala virar "playing" e drena todo o backlog de snapshots.
 * Robusto ao número exato de broadcasts (cada join no lobby agora notifica
 * todos os presentes — F5, corrige o botão "Preencher com Bots" sumido).
 */
async function waitPlayingAndDrain(clients: ConnectedClient[]): Promise<void> {
  for (const c of clients) {
    let snap = await syncAndWait(c);
    let tries = 0;
    while (snap.status !== "playing" && tries < 100) {
      await new Promise((r) => setTimeout(r, 20));
      snap = await syncAndWait(c);
      tries++;
    }
    drainAll(c);
  }
}

const SEED = 42;

// ---- Suite de contrato (shared) --------------------------------------

describe("shared wire contract", () => {
  it("accepts valid playCard action", () => {
    const action = { type: "playCard", card: { suit: "paus", rank: "3" } };
    expect(validateAction(action)).toEqual(action);
  });

  it("accepts valid truco raise action", () => {
    const action = { type: "truco", action: "raise" };
    expect(validateAction(action)).toEqual(action);
  });

  it("accepts valid truco accept action", () => {
    const action = { type: "truco", action: "accept" };
    expect(validateAction(action)).toEqual(action);
  });

  it("accepts valid truco run action", () => {
    const action = { type: "truco", action: "run" };
    expect(validateAction(action)).toEqual(action);
  });

  it("accepts valid elevenDecision play", () => {
    const action = { type: "elevenDecision", decision: "play" };
    expect(validateAction(action)).toEqual(action);
  });

  it("accepts valid elevenDecision run", () => {
    const action = { type: "elevenDecision", decision: "run" };
    expect(validateAction(action)).toEqual(action);
  });

  it("rejects malformed card suit", () => {
    const action = {
      type: "playCard",
      card: { suit: "invalid", rank: "3" },
    };
    expect(validateAction(action)).toBeNull();
  });

  it("rejects malformed card rank", () => {
    const action = {
      type: "playCard",
      card: { suit: "paus", rank: "11" },
    };
    expect(validateAction(action)).toBeNull();
  });

  it("rejects malformed truco action", () => {
    const action = { type: "truco", action: "fold" };
    expect(validateAction(action)).toBeNull();
  });

  it("rejects wrong shape (missing type)", () => {
    const action = { card: { suit: "paus", rank: "3" } };
    expect(validateAction(action)).toBeNull();
  });

  it("rejects extra fields on top-level (strict)", () => {
    const action = {
      type: "playCard",
      card: { suit: "paus", rank: "3" },
      extra: true,
    };
    // strictObject no top-level via discriminatedUnion — campos extras rejeitados.
    expect(validateAction(action)).toBeNull();
  });

  it("rejects extra fields inside card (strict)", () => {
    const action = {
      type: "playCard",
      card: { suit: "paus", rank: "3", extra: 1 },
    };
    // strictObject no cardSchema rejeita campo extra.
    expect(validateAction(action)).toBeNull();
  });

  it("rejects null payload", () => {
    expect(validateAction(null)).toBeNull();
  });

  it("rejects string payload", () => {
    expect(validateAction("invalid")).toBeNull();
  });
});

// ---- Suite do servidor -----------------------------------------------

describe("TrucoRoom (F2 slice 1)", () => {
  let gameServer: ColyseusTestServer;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  // -- Setup helpers ---------------------------------------------------

  /** Cria sala, conecta 4 jogadores, drena snapshots de join + broadcast. */
  async function setup4Players(seed?: number): Promise<ConnectedClient[]> {
    const room = await gameServer.createRoom(
      "truco",
      seed === undefined ? {} : { seed },
    );
    const clients3 = await connectNWithQueue(gameServer, room, 3);
    const client4 = await connectWithQueue(gameServer, room);
    const allCc = [...clients3, client4];

    // Drena snapshots de onJoin (1 por cliente).
    await drainJoinSnapshots(allCc);
    // Dono inicia a partida (sem auto-start no 4º join).
    allCc[0]!.raw.send("startGame", {});
    // Espera a sala virar "playing" e drena o backlog de broadcasts.
    await waitPlayingAndDrain(allCc);
    return allCc;
  }

  // -- Testes ----------------------------------------------------------

  it("rejects action before 4 players (roomNotReady)", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room);

    client.raw.send("action", {
      payload: { type: "playCard", card: { suit: "paus", rank: "4" } },
    });

    const msg = (await waitForInQueue(
      client,
      "actionRejected",
    )) as ActionRejectedMessage;
    expect(msg.error).toBe("roomNotReady");
  });

  it("rejects malformed action payload with malformedPayload", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room);
    // Não envia payload — mensagem vazia.
    client.raw.send("action", {});
    const msg = (await waitForInQueue(
      client,
      "actionRejected",
    )) as ActionRejectedMessage;
    expect(msg.error).toBe("malformedPayload");
  });

  it("rejects action with invalid payload type", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room);

    client.raw.send("action", { payload: "not-an-object" });
    const msg = (await waitForInQueue(
      client,
      "actionRejected",
    )) as ActionRejectedMessage;
    expect(msg.error).toBe("malformedPayload");
  });

  it("does not expose seed in playing snapshot metadata", async () => {
    const allCc = await setup4Players(SEED);
    const snap = await syncAndWait(allCc[0]!);
    expect(snap.status).toBe("playing");
    expect(snap.metadata).toBeDefined();
    // Não deve ter seed nem replayMetadata.
    expect(snap.metadata!.rulesetName).toBeTruthy();
    expect(snap.metadata!.rulesetVersion).toBeTruthy();
    expect(snap.metadata!.prngVersion).toBeTruthy();
    expect((snap.metadata as Record<string, unknown>).seed).toBeUndefined();
    expect(snap.replayMetadata).toBeUndefined();
    // JSON serialize/deserialize deve preservar ausência de seed.
    const json = JSON.parse(JSON.stringify(snap)) as SnapshotMessage;
    expect(json.replayMetadata).toBeUndefined();
    expect((json.metadata as Record<string, unknown>).seed).toBeUndefined();
  });

  it("exposes replayMetadata with seed only at finished status", async () => {
    // Joga uma partida até o fim com seed fixa.
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const allCc = await connectNWithQueue(gameServer, room, 4).then((c) =>
      drainJoinSnapshots(c).then(() => c),
    );

    // Dono inicia a partida.
    allCc[0]!.raw.send("startGame", {});

    // Espera a sala virar "playing" e drena o backlog de broadcasts.
    await waitPlayingAndDrain(allCc);

    // Joga ações válidas até o fim da partida. Além de cartas, resolve mão de
    // onze; sem isso a simulação pararia quando um time chegasse a 11 tentos.
    let safety = 0;
    while (safety < 1000) {
      let acted = false;
      for (const cc of allCc) {
        drainAll(cc);
        const snap = await syncAndWait(cc);
        if (snap.status === "finished") break;
        const legalActions = snap.view?.legalActions ?? [];
        const action =
          legalActions.find((candidate) => candidate.type === "playCard") ??
          legalActions.find(
            (candidate) =>
              candidate.type === "elevenDecision" &&
              candidate.decision === "play",
          ) ??
          legalActions[0];
        if (action) {
          cc.raw.send("action", { payload: action });
          await waitForInQueue(cc, "snapshot");
          acted = true;
          break;
        }
      }
      if (!acted) break;
      safety++;
    }

    // Verifica snapshot final.
    for (const cc of allCc) drainAll(cc);
    const finalSnap = await syncAndWait(allCc[0]!);
    expect(finalSnap.status).toBe("finished");
    expect(finalSnap.replayMetadata).toBeDefined();
    expect(finalSnap.replayMetadata?.seed).toBe(SEED);
  });

  it("sends playing status on broadcast after startGame with 4 seats", async () => {
    const allCc = await setup4Players(SEED);
    const snap = await syncAndWait(allCc[0]!);
    expect(snap.status).toBe("playing");
    expect(snap.connectedPlayers).toBe(4);
    expect(snap.view?.handCards).toHaveLength(3);
  });

  it("does not leak MatchState.hand.cards in snapshots (structural)", async () => {
    const allCc = await setup4Players(SEED);

    for (const cc of allCc) {
      const snap = await syncAndWait(cc);
      // Snapshot não deve ter campo 'cards' (do MatchState) no view.
      // PlayerView não expõe 'cards', apenas 'handCards' e 'currentVaza'.
      const json = JSON.parse(JSON.stringify(snap));
      // Verifica que o JSON do view não contém array de 4 mãos.
      if (json.view) {
        expect(json.view.cards).toBeUndefined();
      }
      // currentVaza.plays deve conter no máximo a carta do próprio jogador
      // visível nas posições (resto null). Mas verificar isso é frágil.
      // Verificação estrutural: view não é MatchState.
      expect((json as Record<string, unknown>).state).toBeUndefined();
    }
  });

  it("does not leak other players' handCards", async () => {
    const allCc = await setup4Players(SEED);

    const handCardsBySeat = new Map<number, readonly Card[]>();
    for (const cc of allCc) {
      const snap = await syncAndWait(cc);
      expect(snap.view).toBeDefined();
      if (snap.view) {
        handCardsBySeat.set(snap.seat, snap.view.handCards);
      }
    }

    for (let seat = 0; seat < 4; seat++) {
      const myCards = handCardsBySeat.get(seat) ?? [];
      for (const card of myCards) {
        for (let otherSeat = 0; otherSeat < 4; otherSeat++) {
          if (otherSeat === seat) continue;
          const otherCards = handCardsBySeat.get(otherSeat) ?? [];
          const found = otherCards.some(
            (c) => c.suit === card.suit && c.rank === card.rank,
          );
          expect(found).toBe(false);
        }
      }
    }
  });

  it("legal playCard reduces hand and emits events", async () => {
    const allCc = await setup4Players(SEED);

    // Encontra quem pode jogar.
    let player: ConnectedClient | null = null;
    let playAction: Action | null = null;

    for (const cc of allCc) {
      const snap = await syncAndWait(cc);
      const pa = snap.view?.legalActions.find((a) => a.type === "playCard");
      if (pa) {
        player = cc;
        playAction = pa;
        break;
      }
    }
    expect(player).not.toBeNull();
    expect(playAction).not.toBeNull();

    const prevSnap = await syncAndWait(player!);
    const prevHandLen = prevSnap.view?.handCards.length ?? 0;
    drainAll(player!);

    player!.raw.send("action", { payload: playAction });

    const snap = (await waitForInQueue(player!, "snapshot")) as SnapshotMessage;
    expect(snap.events).toBeDefined();
    if (snap.events) {
      expect(snap.events.length).toBeGreaterThan(0);
      const cardEvent = snap.events.find((e) => e.type === "cardPlayed");
      expect(cardEvent).toBeDefined();
    }
    expect(snap.view?.handCards.length).toBe(prevHandLen - 1);
  });

  it("invalid action returns actionRejected and preserves full state", async () => {
    const allCc = await setup4Players(SEED);

    const player = allCc[0]!;
    const mySnap = await syncAndWait(player);
    if (!mySnap.view) throw new Error("expected view");

    const myView = mySnap.view;
    const myHand = [...myView.handCards];
    const myCurrentVaza = myView.currentVaza
      ? { ...myView.currentVaza, plays: [...myView.currentVaza.plays] }
      : null;

    // Tenta jogar carta que certamente não está na mão.
    const testCard: Card = { suit: "paus", rank: "7" };

    drainAll(player);
    player.raw.send("action", {
      payload: { type: "playCard", card: testCard },
    });

    const msg = (await waitForInQueue(
      player,
      "actionRejected",
    )) as ActionRejectedMessage;
    expect(msg.error).toBeTruthy();
    expect(msg.error).not.toBe("roomNotReady");
    expect(msg.error).not.toBe("malformedPayload");

    // Verifica que handCards não mudaram.
    const syncSnap = await syncAndWait(player);
    expect(syncSnap.view?.handCards).toEqual(myHand);
    // Verifica que currentVaza não foi iniciada (bug corrigido).
    expect(syncSnap.view?.currentVaza).toEqual(myCurrentVaza);
  });

  it("sync command returns current state", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room);
    drainAll(client);

    const snap = await syncAndWait(client);
    expect(snap.status).toBe("waiting");
    expect([0, 1, 2, 3]).toContain(snap.seat);
  });

  it("disconnect after start replaces the player with a bot", async () => {
    const allCc = await setup4Players(SEED);
    const victim = allCc[0]!;
    const other = allCc[1]!;

    // Saída voluntária mantém a partida com o bot no assento.
    victim.raw.leave();

    await new Promise((resolve) => setTimeout(resolve, 100));
    const snap = await syncAndWait(other);
    expect(other.raw.connection.isOpen).toBe(true);
    expect(snap.status).toBe("playing");
    expect(snap.connectedPlayers).toBe(4);

    // A sala só fecha quando o último humano sai.
    allCc[1]!.raw.leave();
    allCc[2]!.raw.leave();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(allCc[3]!.raw.connection.isOpen).toBe(true);
    allCc[3]!.raw.leave();
  });

  it("before game start, leaving frees the seat while another client remains", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client1 = await connectWithQueue(gameServer, room);
    const client2 = await connectWithQueue(gameServer, room); // mantém sala viva

    drainAll(client1);
    const snap1 = await syncAndWait(client1);
    const originalSeat = snap1.seat;

    client1.raw.leave();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reconecta — seat deve ser o mesmo (liberado).
    const client3 = await connectWithQueue(gameServer, room);
    drainAll(client3);
    const snap3 = await syncAndWait(client3);
    expect(snap3.seat).toBe(originalSeat);

    // client2 ainda está lá (previne autoDispose).
    client2.raw.leave();
  });

  it("rejects decimal seed on createRoom", async () => {
    await expect(
      gameServer.createRoom("truco", { seed: 3.14 }),
    ).rejects.toThrow();
  });
});
