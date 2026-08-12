/* ------------------------------------------------------------------ */
/*  Store: menu — validação, transição de tela, fluxos de criação,     */
/*  reconexão unitária                                                 */
/* ------------------------------------------------------------------ */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotMessage } from "@trucoviski/shared";

/* stable SDK mock via vi.hoisted (determinístico, sem servidor) */

const { mockCreate, mockReconnect, mockJoinById } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockReconnect: vi.fn(),
  mockJoinById: vi.fn(),
}));

const {
  mockRoomSend,
  mockRoomOnMessage,
  mockRoomOnLeave,
  mockRoomOnError,
  mockRoomLeave,
} = vi.hoisted(() => ({
  mockRoomSend: vi.fn(),
  mockRoomOnMessage: vi.fn(),
  mockRoomOnLeave: Object.assign(vi.fn(), { clear: vi.fn() }),
  mockRoomOnError: Object.assign(vi.fn(), { clear: vi.fn() }),
  mockRoomLeave: vi.fn(),
}));

vi.mock("@colyseus/sdk", () => ({
  Client: vi.fn(function () {
    return {
      create: mockCreate,
      reconnect: mockReconnect,
      joinById: mockJoinById,
    };
  }),
}));

vi.mock("../apps/web/src/utils/sounds.ts", () => ({
  sounds: {
    playDeal: vi.fn(),
    playPlay: vi.fn(),
    playTomatoThrow: vi.fn(),
    playTomatoSplat: vi.fn(),
  },
}));

vi.stubGlobal("window", {
  location: {
    origin: "http://localhost:2568",
    href: "http://localhost:5173/",
    protocol: "http:",
    hostname: "localhost",
  },
  history: { replaceState: vi.fn() },
});

const { useStore } = await import("../apps/web/src/store.js");

function buildMockRoom() {
  return {
    roomId: "mock-room-id",
    sessionId: "mock-session-id",
    reconnectionToken: "mock-token",
    send: mockRoomSend,
    onMessage: mockRoomOnMessage,
    onLeave: mockRoomOnLeave,
    onError: mockRoomOnError,
    leave: mockRoomLeave,
  };
}

function stubWindow() {
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:2568",
      href: "http://localhost:5173/",
      protocol: "http:",
      hostname: "localhost",
    },
    history: { replaceState: vi.fn() },
  });
}

function stubSessionStorage(value: string | null = null) {
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
}

function stubSessionStorageWithSession(
  session: {
    reconnectionToken: string;
    roomId: string;
    nickname: string;
  } | null,
) {
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((key: string) =>
      key === "trucoviski.session" && session ? JSON.stringify(session) : null,
    ),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
}

function resetMocks() {
  mockCreate.mockReset();
  mockReconnect.mockReset();
  mockJoinById.mockReset();
  mockRoomSend.mockClear();
  mockRoomOnMessage.mockClear();
  mockRoomOnLeave.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockRoomOnLeave as any).clear.mockClear();
  mockRoomOnError.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockRoomOnError as any).clear.mockClear();
  mockRoomLeave.mockClear();
  stubWindow();
  stubSessionStorage();
  useStore.getState().reset();
}

// ---- test suites ----------------------------------------------------

describe("store menu — validação e snapshot", () => {
  beforeEach(resetMocks);
  afterEach(() => vi.unstubAllGlobals());

  it("createBotGame exige nome", async () => {
    await useStore.getState().createBotGame();
    expect(useStore.getState().error).toBe("Escolha um nickname primeiro.");
    expect(useStore.getState().screen).toBe("home");
    expect(useStore.getState().connecting).toBe(false);
  });

  it("createRoom exige nome", async () => {
    await useStore.getState().createRoom();
    expect(useStore.getState().error).toBe("Escolha um nickname primeiro.");
    expect(useStore.getState().screen).toBe("home");
  });

  it("snapshot playing muda lobby para mesa", () => {
    useStore.setState({ screen: "lobby", nickname: "Humano" });
    const snap: SnapshotMessage = {
      type: "snapshot",
      seat: 0,
      status: "playing",
      connectedPlayers: 4,
      metadata: {
        rulesetName: "paulista",
        rulesetVersion: "1.0.0",
        prngVersion: "mulberry32/1.0.0",
      },
      view: null,
      events: [],
      nicknames: { 0: "Humano", 1: "Bot 2", 2: "Bot 3", 3: "Bot 4" },
      isOwner: true,
    };
    useStore.getState().handleSnapshot(snap);
    expect(useStore.getState().screen).toBe("mesa");
    expect(useStore.getState().status).toBe("playing");
  });
});

describe("store menu — rede e fillBots", () => {
  beforeEach(resetMocks);
  afterEach(() => vi.unstubAllGlobals());

  it("createRoom com erro de rede volta a estado utilizável e permite retentar", async () => {
    useStore.setState({ nickname: "Test" });
    mockCreate.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await useStore.getState().createRoom();

    const state = useStore.getState();
    expect(state.connecting).toBe(false);
    expect(state.screen).toBe("home");
    expect(state.error).toContain("Erro ao criar sala");
    expect(state.room).toBeNull();

    // Retentar demonstra que a interface não fica travada.
    mockCreate.mockResolvedValueOnce(buildMockRoom());

    await useStore.getState().createRoom();

    const retryState = useStore.getState();
    expect(retryState.connecting).toBe(false);
    expect(retryState.error).toBeNull();
    expect(retryState.screen).toBe("lobby");
    expect(mockRoomSend).toHaveBeenCalledWith("sync", {});
  });

  it("createRoom (versus) NÃO envia fillBots", async () => {
    useStore.setState({ nickname: "Versus" });
    mockCreate.mockResolvedValueOnce(buildMockRoom());

    await useStore.getState().createRoom();

    expect(mockCreate).toHaveBeenCalledWith("truco", {
      nickname: "Versus",
      clientId: expect.stringMatching(/.{8,}/),
    });
    expect(mockRoomSend).toHaveBeenCalledWith("sync", {});
    expect(mockRoomSend).not.toHaveBeenCalledWith(
      "fillBots",
      expect.anything(),
    );
    expect(mockRoomSend).not.toHaveBeenCalledWith(
      "startGame",
      expect.anything(),
    );
    expect(useStore.getState().screen).toBe("lobby");
  });

  it("createBotGame envia fillBots e startGame após criar sala", async () => {
    useStore.setState({ nickname: "BotMode" });
    mockCreate.mockResolvedValueOnce(buildMockRoom());

    await useStore.getState().createBotGame();

    expect(mockCreate).toHaveBeenCalledWith("truco", {
      nickname: "BotMode",
      clientId: expect.stringMatching(/.{8,}/),
    });
    expect(mockRoomSend).toHaveBeenCalledWith("fillBots", {});
    expect(mockRoomSend).toHaveBeenCalledWith("startGame", {});
    expect(useStore.getState().screen).toBe("lobby");
  });
});

describe("store menu — boot reconexão (cobre ambos modos, idênticos)", () => {
  beforeEach(resetMocks);
  afterEach(() => vi.unstubAllGlobals());

  it("boot reconecta via reconnectionToken do sessionStorage", async () => {
    stubSessionStorageWithSession({
      reconnectionToken: "my-reconnect-token",
      roomId: "my-room-id",
      nickname: "ReconnectUser",
    });

    mockReconnect.mockResolvedValueOnce(buildMockRoom());

    await useStore.getState().boot();

    expect(mockReconnect).toHaveBeenCalledWith("my-reconnect-token");
    expect(mockRoomSend).toHaveBeenCalledWith("sync", {});
    expect(useStore.getState().screen).toBe("lobby");
    expect(useStore.getState().nickname).toBe("ReconnectUser");
    expect(useStore.getState().roomId).toBe("my-room-id");
  });

  it("boot faz fallback para joinById quando reconnect falha", async () => {
    stubSessionStorageWithSession({
      reconnectionToken: "stale-token",
      roomId: "room-42",
      nickname: "FallbackUser",
    });

    mockReconnect.mockRejectedValueOnce(new Error("invalid token"));
    mockJoinById.mockResolvedValueOnce(buildMockRoom());

    await useStore.getState().boot();

    expect(mockReconnect).toHaveBeenCalledWith("stale-token");
    expect(mockJoinById).toHaveBeenCalledWith("room-42", {
      nickname: "FallbackUser",
      clientId: expect.stringMatching(/.{8,}/),
    });
    expect(useStore.getState().screen).toBe("lobby");
    expect(useStore.getState().nickname).toBe("FallbackUser");
  });

  it("boot cai para home quando toda reconexão falha", async () => {
    stubSessionStorageWithSession({
      reconnectionToken: "expired-token",
      roomId: "old-room",
      nickname: "Ghost",
    });

    mockReconnect.mockRejectedValueOnce(new Error("expired"));
    mockJoinById.mockRejectedValueOnce(new Error("room gone"));

    await useStore.getState().boot();

    expect(useStore.getState().screen).toBe("home");
    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().room).toBeNull();
  });
});

/*
 * Reconexão em modo bots: o caminho de reconexão no store (onLeave →
 * attemptReconnect e boot → readSession) é idêntico para qualquer modo, pois a
 * sala de bots usa o mesmo tipo Colyseus ("truco") e o reconnectionToken é
 * persistido no sessionStorage da mesma forma. O teste E2E
 * 05-mobile-pwa-reconnect.spec.ts cobre o cenário 1 humano + 3 bots (via
 * create-room + fill-bots). Não é necessário duplicar fluxo E2E para o botão
 * "Jogar contra bots" — a validação é unitária (este arquivo) + E2E existente.
 */
