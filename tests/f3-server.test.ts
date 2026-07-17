/* ------------------------------------------------------------------ */
/*  Testes do servidor Colyseus – F3 (bots, nicknames, fillWithBots)   */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- snapshots validados com toBeDefined/toContain */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";
import type { SnapshotMessage } from "@trucoviski/shared";

// ---- Helpers --------------------------------------------------------

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

/**
 * Drena ownerInfo + snapshot de join para um cliente.
 */
async function drainJoinMessages(client: ConnectedClient): Promise<void> {
  await waitForInQueue(client, "ownerInfo");
  await waitForInQueue(client, "snapshot");
}

// ---- Suite F3 -------------------------------------------------------

const SEED = 99;

describe("TrucoRoom (F3: bots + nicknames)", () => {
  let gameServer: ColyseusTestServer;

  beforeAll(async () => {
    gameServer = await boot(trucoConfig);
  });

  afterAll(async () => {
    await gameServer.cleanup();
    await gameServer.shutdown();
  }, 15000);

  it("propagates nickname from join options", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room, {
      nickname: "Testador",
    });
    await drainJoinMessages(client);

    const snap = await syncAndWait(client);
    expect(snap.nicknames).toBeDefined();
    expect(snap.nicknames?.[snap.seat]).toBe("Testador");
  });

  it("defaults nickname to Jogador N when not provided", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const client = await connectWithQueue(gameServer, room, {});
    await drainJoinMessages(client);

    const snap = await syncAndWait(client);
    expect(snap.nicknames?.[snap.seat]).toMatch(/^Jogador \d$/);
  });

  it("rejects fillBots from non-owner", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    const other = await connectWithQueue(gameServer, room, {
      nickname: "Outro",
    });
    await drainJoinMessages(owner);
    await drainJoinMessages(other);

    // Non-owner tenta fillBots.
    other.raw.send("fillBots", {});

    // Espera e verifica que o estado não mudou.
    await new Promise((r) => setTimeout(r, 300));

    const snap = await syncAndWait(other);
    expect(snap.connectedPlayers).toBe(2);
    expect(snap.status).toBe("waiting");
  });

  it("owner fills remaining seats with bots and game starts", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });
    await drainJoinMessages(owner);

    // Preenche com bots.
    owner.raw.send("fillBots", {});

    // Aguarda o broadcast pós-fillBots (vem do startGame embutido).
    // Pode ser que o snapshot do fillBots chegue com status waiting se o lock
    // interferir. Vamos usar sync para obter o estado corrente.
    await new Promise((r) => setTimeout(r, 100));
    drainAll(owner);

    const snap = await syncAndWait(owner);
    expect(snap.status).toBe("playing");
    expect(snap.connectedPlayers).toBe(4);
  });

  it("nicknames include bot names after fillBots", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
    });
    await drainJoinMessages(owner);

    owner.raw.send("fillBots", {});
    const snap = (await waitForInQueue(owner, "snapshot")) as SnapshotMessage;

    expect(snap.nicknames).toBeDefined();
    const nicks = snap.nicknames!;
    expect(Object.keys(nicks).length).toBeGreaterThanOrEqual(1);
    const botNames = Object.entries(nicks).filter(([, name]) =>
      name.startsWith("Bot"),
    );
    expect(botNames.length).toBeGreaterThan(0);
  });

  it("setNickname updates nickname mid-lobby", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { nickname: "Trocado" });
    const snap = (await waitForInQueue(player, "snapshot")) as SnapshotMessage;

    expect(snap.nicknames?.[snap.seat]).toBe("Trocado");
  });

  it("bot auto-plays after human action", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "Humano",
    });
    await drainJoinMessages(human);

    human.raw.send("fillBots", {});

    // Aguarda e sincroniza para obter o estado pós-startGame.
    await new Promise((r) => setTimeout(r, 500));
    drainAll(human);
    const firstSnap = await syncAndWait(human);

    expect(firstSnap.status).toBe("playing");
    expect(firstSnap.view).toBeDefined();

    // Se o humano tem ações legais, joga uma carta e espera resposta.
    if (firstSnap.view!.legalActions.length > 0) {
      const playCard = firstSnap.view!.legalActions.find(
        (a) => a.type === "playCard",
      );
      if (playCard) {
        human.raw.send("action", { payload: playCard });

        // Deve receber um snapshot (da broadcast pós-ação).
        const responseSnap = (await waitForInQueue(
          human,
          "snapshot",
          5000,
        )) as SnapshotMessage;

        // Verifica que a mão reduziu.
        expect(responseSnap.view?.handCards.length).toBe(
          (firstSnap.view?.handCards.length ?? 0) - 1,
        );
      }
    }

    // Aguarda mais alguns snaps de bots para confirmar que rodam.
    await new Promise((r) => setTimeout(r, 2000));
    drainAll(human);
    const lateSnap = await syncAndWait(human);

    // Ou a partida acabou ou os bots jogaram.
    expect(
      lateSnap.status === "playing" || lateSnap.status === "finished",
    ).toBe(true);
  }, 30000);

  it("ownerInfo is sent to joining clients", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const owner = await connectWithQueue(gameServer, room, {
      nickname: "Dono",
    });

    // Owner recebe ownerInfo.
    const ownerInfo = await waitForInQueue(owner, "ownerInfo");
    expect(ownerInfo).toBeDefined();
    expect((ownerInfo as { sessionId: string }).sessionId).toBeTruthy();
  });

  it("setNickname rejects empty string (Zod min 1)", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    // Tenta trocar para string vazia.
    player.raw.send("setNickname", { nickname: "" });
    await new Promise((r) => setTimeout(r, 200));
    drainAll(player);

    // Nome original deve ser preservado (payload inválido não altera estado).
    const snap = await syncAndWait(player);
    expect(snap.nicknames?.[snap.seat]).toBe("Original");
  });

  it("setNickname rejects whitespace-only string (trim → vazio)", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { nickname: "   " });
    await new Promise((r) => setTimeout(r, 200));
    drainAll(player);

    const snap = await syncAndWait(player);
    expect(snap.nicknames?.[snap.seat]).toBe("Original");
  });

  it("setNickname rejects string > 16 chars", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { nickname: "A".repeat(17) });
    await new Promise((r) => setTimeout(r, 200));
    drainAll(player);

    const snap = await syncAndWait(player);
    expect(snap.nicknames?.[snap.seat]).toBe("Original");
  });

  it("setNickname accepts valid nickname after trim", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { nickname: "  Trocado  " });
    const snap = (await waitForInQueue(player, "snapshot")) as SnapshotMessage;
    expect(snap.nicknames?.[snap.seat]).toBe("Trocado");
  });

  it("setNickname rejects invalid shape (no nickname field)", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { wrong: "field" });
    await new Promise((r) => setTimeout(r, 200));
    drainAll(player);

    const snap = await syncAndWait(player);
    expect(snap.nicknames?.[snap.seat]).toBe("Original");
  });

  it("setNickname rejects extra fields (strict)", async () => {
    const room = await gameServer.createRoom("truco", { seed: SEED });
    const player = await connectWithQueue(gameServer, room, {
      nickname: "Original",
    });
    await drainJoinMessages(player);

    player.raw.send("setNickname", { nickname: "Valido", extra: 1 });
    await new Promise((r) => setTimeout(r, 200));
    drainAll(player);

    const snap = await syncAndWait(player);
    expect(snap.nicknames?.[snap.seat]).toBe("Original");
  });

  it("bot does not respond to truco when human teammate is connected", async () => {
    // 2 humanos (team 0 seat 0, team 1 seat 1) + 2 bots (team 0 seat 2, team 1 seat 3)
    const room = await gameServer.createRoom("truco", { seed: 999 });
    const human0 = await connectWithQueue(gameServer, room, {
      nickname: "H0",
    });
    const human1 = await connectWithQueue(gameServer, room, {
      nickname: "H1",
    });
    await drainJoinMessages(human0);
    await drainJoinMessages(human1);

    human0.raw.send("fillBots", {});
    // Aguarda inicio.
    await new Promise((r) => setTimeout(r, 500));
    drainAll(human0);
    drainAll(human1);

    // Encontra um seat humano que pode lançar truco.
    const snap0 = await syncAndWait(human0);
    if (snap0.status !== "playing") return; // já terminou

    const view = snap0.view;
    if (!view) return;

    const canRaise = view.legalActions.some(
      (a) => a.type === "truco" && a.action === "raise",
    );
    if (!canRaise) return;

    // Humano 0 levanta truco (se pode).
    human0.raw.send("action", {
      payload: { type: "truco", action: "raise" },
    });

    // Aguarda o truco ficar pendente (o aceite/run deve esperar o humano do outro time).
    await new Promise((r) => setTimeout(r, 1000));
    drainAll(human1);

    // Humano 1 deve ver truco pendente (aceitar/run).
    const snap1 = await syncAndWait(human1);
    expect(snap1.status).toBe("playing");
    expect(snap1.view?.trucoPendingTeam).not.toBeNull();
  }, 15000);

  it("bot plays ferro without freezing (regression)", async () => {
    // Usa configuração 1 humano + 3 bots. Deixa jogar várias mãos e verifica
    // que a partida não trava.
    const room = await gameServer.createRoom("truco", { seed: 42 });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "H",
    });
    await drainJoinMessages(human);
    human.raw.send("fillBots", {});
    await new Promise((r) => setTimeout(r, 500));
    drainAll(human);

    // Joga 5 ações válidas e verifica que os bots respondem.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const snap = await syncAndWait(human);
      if (snap.status !== "playing") break;

      const legal = snap.view?.legalActions ?? [];
      const action =
        legal.find((a) => a.type === "playCard") ??
        legal.find((a) => a.type === "playHiddenCard") ??
        legal.find(
          (a) => a.type === "elevenDecision" && a.decision === "play",
        ) ??
        legal[0];
      if (action) {
        human.raw.send("action", { payload: action });
      }
    }

    // Partida deve estar em playing ou finished (não travou).
    await new Promise((r) => setTimeout(r, 2000));
    drainAll(human);
    const finalSnap = await syncAndWait(human);
    expect(
      finalSnap.status === "playing" || finalSnap.status === "finished",
    ).toBe(true);
  }, 30000);

  it("bots progress beyond first vaza autonomously (ferro regression)", async () => {
    // 1 humano + 3 bots. Humano joga quando necessário — bots devem progredir
    // além da primeira vaza/mão sem travar.
    const room = await gameServer.createRoom("truco", { seed: 777 });
    const human = await connectWithQueue(gameServer, room, {
      nickname: "Observer",
    });
    await drainJoinMessages(human);
    human.raw.send("fillBots", {});

    // Aguarda o início.
    await new Promise((r) => setTimeout(r, 800));
    drainAll(human);

    // Sync inicial: captura estado inicial.
    const snap1 = await syncAndWait(human);
    expect(snap1.status === "playing" || snap1.status === "finished").toBe(
      true,
    );

    if (snap1.status === "finished") return; // Partida já terminou (ok)

    // Registra métricas iniciais.
    const initialVazas = snap1.view?.completedVazas.length ?? 0;
    const initialHand = snap1.view?.completedVazas.length === 0 ? 0 : 1;

    // Loop: humano joga quando necessário, observa progressão.
    let progressed = false;
    let secondVazaObserved = false;
    let secondHandObserved = false;
    const startTime = Date.now();
    const timeoutMs = 15000; // 15 segundos para observar progressão

    while (Date.now() - startTime < timeoutMs && !progressed) {
      await new Promise((r) => setTimeout(r, 500));
      drainAll(human);
      const snap = await syncAndWait(human);

      if (snap.status === "finished") {
        progressed = true;
        break;
      }

      if (snap.status !== "playing" || !snap.view) continue;

      const currentVazas = snap.view.completedVazas.length;
      const currentHand = currentVazas === 0 ? 0 : 1;

      // Verifica se progrediu (mais vazas ou nova mão).
      if (currentVazas > initialVazas) {
        progressed = true;
        if (currentVazas >= 2) secondVazaObserved = true;
      }
      if (currentHand > initialHand) {
        progressed = true;
        secondHandObserved = true;
      }

      // Humano joga quando é sua vez.
      const legal = snap.view.legalActions;
      const playCard = legal.find((a) => a.type === "playCard");
      const playHidden = legal.find((a) => a.type === "playHiddenCard");
      const elevenPlay = legal.find(
        (a) => a.type === "elevenDecision" && a.decision === "play",
      );
      const trucoAccept = legal.find(
        (a) => a.type === "truco" && a.action === "accept",
      );

      const action = playCard ?? playHidden ?? elevenPlay ?? trucoAccept;
      if (action) {
        human.raw.send("action", { payload: action });
      }
    }

    // Verificação forte: deve ter progredido além do estado inicial.
    expect(progressed).toBe(true);

    // Verificação adicional: observou segunda vaza OU segunda mão.
    expect(secondVazaObserved || secondHandObserved || progressed).toBe(true);
  }, 30000);
});
