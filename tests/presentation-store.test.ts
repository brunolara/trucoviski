/* ------------------------------------------------------------------ */
/*  Store: fases de apresentação (reveal → vaza → sweep → mão)         */
/* ------------------------------------------------------------------ */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameEvent,
  PlayerView,
  SnapshotMessage,
} from "@trucoviski/shared";

const { mockCreate, mockReconnect, mockJoinById } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockReconnect: vi.fn(),
  mockJoinById: vi.fn(),
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

vi.stubGlobal("sessionStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

const { useStore } = await import("../apps/web/src/store.js");

const PLAYS = [
  { rank: "3", suit: "copas" },
  { rank: "2", suit: "espadas" },
  { rank: "A", suit: "ouros" },
  { rank: "K", suit: "paus" },
] as const;

const COVERED = [false, false, false, false] as const;

function baseView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 0,
    handCards: [],
    vira: { rank: "7", suit: "paus" },
    completedVazas: [
      {
        plays: PLAYS,
        covered: COVERED,
        winner: 0,
        tiedSeats: [],
      },
    ],
    currentVaza: null,
    scores: [1, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    trucoRaises: [],
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions: [],
    ...overrides,
  };
}

function snapWith(
  events: GameEvent[],
  status: SnapshotMessage["status"] = "playing",
): SnapshotMessage {
  return {
    type: "snapshot",
    seat: 0,
    status,
    connectedPlayers: 4,
    ownerSessionId: "owner",
    metadata: {
      rulesetName: "paulista",
      rulesetVersion: "1.0.0",
      prngVersion: "mulberry32/1.0.0",
    },
    view: baseView(status === "finished" ? { scores: [12, 3] } : undefined),
    events,
    nicknames: { 0: "Ana", 1: "Beto", 2: "Carla", 3: "Duda" },
    ...(status === "finished"
      ? {
          replayMetadata: {
            rulesetName: "paulista",
            rulesetVersion: "1.0.0",
            prngVersion: "mulberry32/1.0.0",
            seed: 1,
          },
        }
      : {}),
  };
}

const vazaCompleted: GameEvent = {
  type: "vazaCompleted",
  vazaNumber: 1,
  plays: PLAYS,
  covered: COVERED,
  winner: 0,
};

const handFinished: GameEvent = {
  type: "handFinished",
  winnerTeam: 0,
  tentos: 1,
  reason: "vazas",
};

describe("store presentation — beats da vaza", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().reset();
    useStore.setState({ screen: "mesa", nickname: "Ana" });
  });

  afterEach(() => {
    useStore.getState().reset();
    vi.useRealTimers();
  });

  it("expande reveal → winner → sweeping → limpa", async () => {
    useStore.getState().handleSnapshot(snapWith([vazaCompleted]));

    // reveal: cartas sem winner
    expect(useStore.getState().tableHold).toEqual({
      plays: PLAYS,
      covered: COVERED,
    });
    expect(useStore.getState().banner).toBeNull();
    expect(useStore.getState().tableHold?.winner).toBeUndefined();
    expect(useStore.getState().tableHold?.sweeping).toBeUndefined();

    await vi.advanceTimersByTimeAsync(600);
    expect(useStore.getState().tableHold?.winner).toBe(0);
    expect(useStore.getState().tableHold?.sweeping).toBeUndefined();
    expect(useStore.getState().banner?.text).toContain("venceu a vaza");

    await vi.advanceTimersByTimeAsync(1600);
    expect(useStore.getState().tableHold?.sweeping).toBe(true);
    expect(useStore.getState().tableHold?.winner).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(useStore.getState().tableHold).toBeNull();
    expect(useStore.getState().banner).toBeNull();
  });

  it("após sweep, mostra banner da mão e limpa", async () => {
    useStore.getState().handleSnapshot(snapWith([vazaCompleted, handFinished]));

    await vi.advanceTimersByTimeAsync(600 + 1600 + 300);
    expect(useStore.getState().tableHold).toBeNull();
    expect(useStore.getState().banner?.text).toContain("tento");

    await vi.advanceTimersByTimeAsync(2200);
    expect(useStore.getState().banner).toBeNull();
  });

  it("skipPresentation encurta a sequência", async () => {
    useStore.getState().handleSnapshot(snapWith([vazaCompleted, handFinished]));
    expect(useStore.getState().tableHold?.winner).toBeUndefined();

    useStore.getState().skipPresentation();
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState().tableHold?.winner).toBe(0);

    useStore.getState().skipPresentation();
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState().tableHold?.sweeping).toBe(true);

    useStore.getState().skipPresentation();
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState().tableHold).toBeNull();
    expect(useStore.getState().banner?.text).toContain("tento");

    useStore.getState().skipPresentation();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState().banner).toBeNull();
  });

  it("adiará screen end até o fim dos holds", async () => {
    useStore.getState().handleSnapshot(
      snapWith(
        [
          vazaCompleted,
          handFinished,
          {
            type: "matchFinished",
            winnerTeam: 0,
            finalScores: [12, 3],
          },
        ],
        "finished",
      ),
    );

    expect(useStore.getState().status).toBe("finished");
    expect(useStore.getState().screen).toBe("mesa");
    expect(useStore.getState().tableHold).not.toBeNull();

    await vi.advanceTimersByTimeAsync(600 + 1600 + 300 + 2200);
    expect(useStore.getState().screen).toBe("end");
    expect(useStore.getState().tableHold).toBeNull();
    expect(useStore.getState().banner).toBeNull();
  });
});
