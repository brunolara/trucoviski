/* ------------------------------------------------------------------ */
/*  Testes do servidor Colyseus – F4 (Social: chat, emote, tomate)   */
/* ------------------------------------------------------------------ */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";

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

async function drainJoinMessages(client: ConnectedClient): Promise<void> {
  await waitForInQueue(client, "ownerInfo");
  await waitForInQueue(client, "snapshot");
}

describe("TrucoRoom (F4: Social & Rate Limits)", () => {
  let gameServer: ColyseusTestServer;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  it("broadcasts chat message to all players", async () => {
    const room = await gameServer.createRoom("truco", { seed: 100 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });

    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    // Send valid chat
    c0.raw.send("chat", { text: "Hello P2!" });

    // Both should receive it
    const msg0 = (await waitForInQueue(c0, "chatMessage")) as {
      seat: number;
      text: string;
    };
    const msg1 = (await waitForInQueue(c1, "chatMessage")) as {
      seat: number;
      text: string;
    };

    expect(msg0.seat).toBe(0);
    expect(msg0.text).toBe("Hello P2!");
    expect(msg1.seat).toBe(0);
    expect(msg1.text).toBe("Hello P2!");
  });

  it("broadcasts emote to all players", async () => {
    const room = await gameServer.createRoom("truco", { seed: 101 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });

    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    // Send valid emote (whitelisted)
    c0.raw.send("emote", { emoji: "👍" });

    const msg0 = (await waitForInQueue(c0, "emote")) as {
      seat: number;
      emoji: string;
    };
    const msg1 = (await waitForInQueue(c1, "emote")) as {
      seat: number;
      emoji: string;
    };

    expect(msg0.seat).toBe(0);
    expect(msg0.emoji).toBe("👍");
    expect(msg1.seat).toBe(0);
    expect(msg1.emoji).toBe("👍");
  });

  it("broadcasts throwTomato to all players", async () => {
    const room = await gameServer.createRoom("truco", { seed: 102 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });

    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    // Send throwTomato
    c0.raw.send("throwTomato", { targetSeat: 1 });

    const msg0 = (await waitForInQueue(c0, "tomatoThrown")) as {
      senderSeat: number;
      targetSeat: number;
    };
    const msg1 = (await waitForInQueue(c1, "tomatoThrown")) as {
      senderSeat: number;
      targetSeat: number;
    };

    expect(msg0.senderSeat).toBe(0);
    expect(msg0.targetSeat).toBe(1);
    expect(msg1.senderSeat).toBe(0);
    expect(msg1.targetSeat).toBe(1);
  });

  it("rate-limits chat to 1 message per 2s", async () => {
    const room = await gameServer.createRoom("truco", { seed: 103 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });
    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    c0.raw.send("chat", { text: "First" });
    await waitForInQueue(c1, "chatMessage");

    // Segunda mensagem dentro da janela de 2s deve ser descartada.
    c0.raw.send("chat", { text: "Second" });
    await new Promise((r) => setTimeout(r, 300));
    expect(c1.messages.some((m) => m.type === "chatMessage")).toBe(false);

    // Após a janela expirar, chat volta a funcionar.
    await new Promise((r) => setTimeout(r, 1800));
    c0.raw.send("chat", { text: "Third" });
    const msg = (await waitForInQueue(c1, "chatMessage")) as { text: string };
    expect(msg.text).toBe("Third");
  }, 10000);

  it("rate-limits emote to 1 per 1.5s", async () => {
    const room = await gameServer.createRoom("truco", { seed: 104 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });
    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    c0.raw.send("emote", { emoji: "👍" });
    await waitForInQueue(c1, "emote");

    c0.raw.send("emote", { emoji: "😂" });
    await new Promise((r) => setTimeout(r, 300));
    expect(c1.messages.some((m) => m.type === "emote")).toBe(false);

    await new Promise((r) => setTimeout(r, 1300));
    c0.raw.send("emote", { emoji: "😢" });
    const msg = (await waitForInQueue(c1, "emote")) as { emoji: string };
    expect(msg.emoji).toBe("😢");
  }, 10000);

  it("rate-limits throwTomato to 1 per 3s", async () => {
    const room = await gameServer.createRoom("truco", { seed: 105 });
    const c0 = await connectWithQueue(gameServer, room, { nickname: "P1" });
    const c1 = await connectWithQueue(gameServer, room, { nickname: "P2" });
    await drainJoinMessages(c0);
    await drainJoinMessages(c1);

    c0.raw.send("throwTomato", { targetSeat: 1 });
    await waitForInQueue(c1, "tomatoThrown");

    c0.raw.send("throwTomato", { targetSeat: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(c1.messages.some((m) => m.type === "tomatoThrown")).toBe(false);

    await new Promise((r) => setTimeout(r, 2800));
    c0.raw.send("throwTomato", { targetSeat: 1 });
    const msg = (await waitForInQueue(c1, "tomatoThrown")) as {
      targetSeat: number;
    };
    expect(msg.targetSeat).toBe(1);
  }, 12000);
});
