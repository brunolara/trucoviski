/* ------------------------------------------------------------------ */
/*  Sala persistente: TTL, clientId, dono, código legível              */
/* ------------------------------------------------------------------ */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { createMatch } from "@trucoviski/engine";
import { trucoConfig } from "@trucoviski/server";
import type { SnapshotMessage } from "@trucoviski/shared";

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
  armEmptyTimer: (ms?: number) => void;
  roomId: string;
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

async function drainJoinMessages(client: ConnectedClient): Promise<void> {
  await waitForInQueue(client, "snapshot");
}

async function syncAndWait(client: ConnectedClient): Promise<SnapshotMessage> {
  client.raw.send("sync", {});
  const payload = await waitForInQueue(client, "snapshot");
  return payload as SnapshotMessage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const SEED = 42;

describe("sala persistente", () => {
  let gameServer: ColyseusTestServer;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  it("sala sobrevive ao lobby vazio", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "humano-01",
    });
    await drainJoinMessages(client);
    await client.raw.leave(true);
    await sleep(300);

    const back = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "humano-01",
    });
    await drainJoinMessages(back);
    const snap = await syncAndWait(back);
    expect(snap.status).toBe("waiting");
  });

  it("TTL descarta a sala vazia", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 1 });
    (room as unknown as TrucoRoomInternal).armEmptyTimer(50);
    await sleep(300);
    await expect(
      gameServer.connectTo(room, { nickname: "Tarde" }),
    ).rejects.toThrow();
  });

  it("dono sobrevive ao F5", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 2 });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "dono-001",
    });
    await drainJoinMessages(owner);
    await owner.raw.leave(true);
    await sleep(100);

    const back = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "dono-001",
    });
    await drainJoinMessages(back);
    const snap = await syncAndWait(back);
    expect(snap.isOwner).toBe(true);
  });

  it("dono interino cede a posse quando o criador volta", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 3 });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "dono-001",
    });
    const other = await connectWithQueue(gameServer, room, {
      nickname: "Outro",
      clientId: "outro-001",
    });
    await drainJoinMessages(owner);
    await drainJoinMessages(other);

    await owner.raw.leave(true);
    await sleep(100);
    drainAll(other);
    const interim = await syncAndWait(other);
    expect(interim.isOwner).toBe(true);

    drainAll(other);
    other.raw.send("fillBots", {});
    await sleep(200);
    const internal = room as unknown as TrucoRoomInternal;
    expect(internal.botSeats.size).toBe(3);
    drainAll(other);
    other.raw.send("startGame", {});
    await sleep(100);
    expect(internal.status).toBe("playing");

    const back = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
      clientId: "dono-001",
    });
    await drainJoinMessages(back);
    drainAll(other);
    const ownerSnap = await syncAndWait(back);
    const otherSnap = await syncAndWait(other);
    expect(ownerSnap.isOwner).toBe(true);
    expect(otherSnap.isOwner).toBe(false);
  });

  it("assento é retomado em partida", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 4 });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
      clientId: "humano-01",
    });
    await drainJoinMessages(human);
    human.raw.send("fillBots", {});
    const filled = await waitForInQueue(human, "snapshot");
    expect((filled as SnapshotMessage).connectedPlayers).toBe(4);
    human.raw.send("startGame", {});
    await sleep(100);
    const playing = await syncAndWait(human);
    expect(playing.status).toBe("playing");
    const seat = playing.seat;

    const internal = room as unknown as TrucoRoomInternal;
    await human.raw.leave(true);
    await sleep(150);
    expect(internal.botSeats.has(seat)).toBe(true);

    const back = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
      clientId: "humano-01",
    });
    await drainJoinMessages(back);
    expect(internal.botSeats.has(seat)).toBe(false);
    const snap = await syncAndWait(back);
    expect(snap.seat).toBe(seat);
  });

  it("estranho é recusado em partida", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 5 });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
      clientId: "humano-01",
    });
    await drainJoinMessages(human);
    human.raw.send("fillBots", {});
    await waitForInQueue(human, "snapshot");
    human.raw.send("startGame", {});
    await sleep(100);
    expect((await syncAndWait(human)).status).toBe("playing");

    const internal = room as unknown as TrucoRoomInternal;
    const occupiedBefore = internal.occupied.size;
    try {
      const stranger = await connectWithQueue(gameServer, room, {
        nickname: "Intruso",
        clientId: "estranho1",
      });
      await sleep(200);
      expect(stranger.raw.connection.isOpen).toBe(false);
    } catch {
      // matchmaker ou onJoin recusou o join
    }
    expect(internal.occupied.size).toBe(occupiedBefore);
  });

  it("bots pausam sem humano e retomam ao reentrar", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 6 });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
      clientId: "humano-01",
    });
    await drainJoinMessages(human);
    human.raw.send("fillBots", {});
    await waitForInQueue(human, "snapshot");
    human.raw.send("startGame", {});
    await sleep(100);
    expect((await syncAndWait(human)).status).toBe("playing");

    const internal = room as unknown as TrucoRoomInternal;
    await human.raw.leave(true);
    await sleep(100);

    const frozen = {
      phase: internal.match.state().phase,
      handNumber: internal.match.state().handNumber,
      scores: [...internal.match.state().scores],
    };
    await sleep(3000);
    const still = internal.match.state();
    expect(still.phase).toBe(frozen.phase);
    expect(still.handNumber).toBe(frozen.handNumber);
    expect([...still.scores]).toEqual(frozen.scores);

    const back = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
      clientId: "humano-01",
    });
    await drainJoinMessages(back);
    await sleep(3500);
    const after = internal.match.state();
    const botsMoved =
      after.phase !== frozen.phase ||
      after.handNumber !== frozen.handNumber ||
      after.scores[0] !== frozen.scores[0] ||
      after.scores[1] !== frozen.scores[1];
    if (!botsMoved) {
      const snap = await syncAndWait(back);
      const play = snap.view?.legalActions.find((a) => a.type === "playCard");
      expect(play).toBeDefined();
      back.raw.send("action", { payload: play });
      await sleep(400);
      const played = internal.match.state();
      expect(
        played.phase !== frozen.phase ||
          JSON.stringify(played.hand?.currentVaza) !==
            JSON.stringify(still.hand?.currentVaza),
      ).toBe(true);
    }
  }, 15000);

  it("código da sala é duas palavras", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 7 });
    expect(room.roomId).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
