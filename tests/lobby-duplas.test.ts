/* ------------------------------------------------------------------ */
/*  Lobby: startGame manual + swapSeats (duplas)                       */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- snapshots validados com toBeDefined */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";
import type { SnapshotMessage } from "@trucoviski/shared";

interface ConnectedClient {
  raw: Awaited<ReturnType<ColyseusTestServer["connectTo"]>>;
  messages: { type: string; payload: unknown }[];
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

async function syncAndWait(client: ConnectedClient): Promise<SnapshotMessage> {
  client.raw.send("sync", {});
  const payload = await waitForInQueue(client, "snapshot");
  return payload as SnapshotMessage;
}

async function drainJoinMessages(client: ConnectedClient): Promise<void> {
  await waitForInQueue(client, "snapshot");
}

const SEED = 77;

describe("Lobby startGame + swapSeats", () => {
  let gameServer: ColyseusTestServer;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  it("startGame de não-dono é ignorado", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    const other = await connectWithQueue(gameServer, room, {
      nickname: "Outro",
    });
    await drainJoinMessages(owner);
    await drainJoinMessages(other);

    owner.raw.send("fillBots", {});
    await new Promise((r) => setTimeout(r, 50));
    drainAll(owner);
    drainAll(other);

    other.raw.send("startGame", {});
    await new Promise((r) => setTimeout(r, 100));
    const snap = await syncAndWait(owner);
    expect(snap.status).toBe("waiting");
    expect(snap.connectedPlayers).toBe(4);
  });

  it("startGame com menos de 4 assentos é ignorado", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED + 1 });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    await drainJoinMessages(owner);

    const p2 = await connectWithQueue(gameServer, room, { nickname: "P2" });
    await drainJoinMessages(p2);
    drainAll(owner);

    const p3 = await connectWithQueue(gameServer, room, { nickname: "P3" });
    await drainJoinMessages(p3);
    drainAll(owner);

    const before = await syncAndWait(owner);
    expect(before.connectedPlayers).toBe(3);
    expect(before.status).toBe("waiting");

    owner.raw.send("startGame", {});
    await new Promise((r) => setTimeout(r, 100));
    const snap = await syncAndWait(owner);
    expect(snap.status).toBe("waiting");
    expect(snap.connectedPlayers).toBe(3);
  });

  it("swapSeats do dono troca humano↔bot", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Bruno",
    });
    await drainJoinMessages(owner);

    owner.raw.send("fillBots", {});
    await new Promise((r) => setTimeout(r, 50));
    drainAll(owner);

    let snap = await syncAndWait(owner);
    expect(snap.seat).toBe(0);
    expect(snap.botSeats).toEqual(expect.arrayContaining([1, 2, 3]));
    const botNameAt1 = snap.nicknames![1]!;

    // Troca seat 0 (humano) com seat 1 (bot)
    owner.raw.send("swapSeats", { a: 0, b: 1 });
    snap = (await waitForInQueue(owner, "snapshot")) as SnapshotMessage;

    expect(snap.seat).toBe(1);
    expect(snap.nicknames![1]).toBe("Bruno");
    expect(snap.nicknames![0]).toBe(botNameAt1);
    expect(snap.botSeats).toEqual(expect.arrayContaining([0, 2, 3]));
    expect(snap.botSeats).not.toContain(1);
  });

  it("swapSeats de não-dono e após playing são ignorados", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    const other = await connectWithQueue(gameServer, room, {
      nickname: "Outro",
    });
    await drainJoinMessages(owner);
    await drainJoinMessages(other);

    other.raw.send("swapSeats", { a: 0, b: 1 });
    await new Promise((r) => setTimeout(r, 80));
    let snap = await syncAndWait(owner);
    expect(snap.seat).toBe(0);
    expect(snap.nicknames![0]).toBe("Dono");
    expect(snap.nicknames![1]).toBe("Outro");

    owner.raw.send("fillBots", {});
    owner.raw.send("startGame", {});
    await new Promise((r) => setTimeout(r, 100));
    drainAll(owner);

    snap = await syncAndWait(owner);
    expect(snap.status).toBe("playing");
    const before = { ...snap.nicknames };
    owner.raw.send("swapSeats", { a: 0, b: 2 });
    await new Promise((r) => setTimeout(r, 80));
    snap = await syncAndWait(owner);
    expect(snap.nicknames).toEqual(before);
    expect(snap.seat).toBe(0);
  });

  it("fillBots após swapSeats não renormaliza humanos", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    const other = await connectWithQueue(gameServer, room, {
      nickname: "Outro",
    });
    await drainJoinMessages(owner);
    await drainJoinMessages(other);

    // Move Outro (seat 1) para seat 3 — buraco em 1.
    owner.raw.send("swapSeats", { a: 1, b: 3 });
    await Promise.all([
      waitForInQueue(owner, "snapshot"),
      waitForInQueue(other, "snapshot"),
    ]);
    drainAll(owner);
    drainAll(other);

    let otherSnap = await syncAndWait(other);
    expect(otherSnap.seat).toBe(3);

    owner.raw.send("fillBots", {});
    await new Promise((r) => setTimeout(r, 50));
    drainAll(owner);
    drainAll(other);

    otherSnap = await syncAndWait(other);
    const ownerSnap = await syncAndWait(owner);
    expect(ownerSnap.seat).toBe(0);
    expect(otherSnap.seat).toBe(3);
    expect(ownerSnap.botSeats?.sort()).toEqual([1, 2]);
    expect(ownerSnap.status).toBe("waiting");
  });

  it("payload inválido de swapSeats é ignorado sem derrubar a sala", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    await drainJoinMessages(owner);

    owner.raw.send("swapSeats", { a: 9, b: -1 });
    await new Promise((r) => setTimeout(r, 80));
    const snap = await syncAndWait(owner);
    expect(snap.status).toBe("waiting");
    expect(snap.seat).toBe(0);
    expect(snap.nicknames![0]).toBe("Dono");
  });
});
