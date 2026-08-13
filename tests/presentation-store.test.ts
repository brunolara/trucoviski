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
    isOwner: true,
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
    const oldVira = { rank: "7" as const, suit: "paus" as const };
    useStore.getState().handleSnapshot({
      ...snapWith([]),
      view: baseView({ vira: oldVira, handCards: [] }),
    });

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
    expect(useStore.getState().view?.vira).toEqual(oldVira);

    await vi.advanceTimersByTimeAsync(600 + 1600 + 300 + 2200);
    expect(useStore.getState().screen).toBe("end");
    expect(useStore.getState().tableHold).toBeNull();
    expect(useStore.getState().banner).toBeNull();
  });

  it("não troca vira nem redeal enquanto apresenta o fim da mão", async () => {
    const oldVira = { rank: "4" as const, suit: "paus" as const };
    const newVira = { rank: "5" as const, suit: "copas" as const };
    const lastCard = { rank: "6" as const, suit: "ouros" as const };
    const nextHand = [
      { rank: "3" as const, suit: "paus" as const },
      { rank: "2" as const, suit: "copas" as const },
      { rank: "A" as const, suit: "espadas" as const },
    ];

    useStore.getState().handleSnapshot({
      ...snapWith([]),
      view: baseView({
        handNumber: 1,
        vira: oldVira,
        handCards: [lastCard],
        scores: [1, 0],
      }),
    });

    useStore.getState().handleSnapshot({
      ...snapWith([
        {
          type: "cardPlayed",
          seat: 0,
          card: lastCard,
          covered: false,
        },
        vazaCompleted,
        handFinished,
        {
          type: "handStarted",
          handNumber: 2,
          dealerSeat: 1,
          vira: newVira,
        },
      ]),
      view: baseView({
        handNumber: 2,
        vira: newVira,
        handCards: nextHand,
        completedVazas: [],
        currentVaza: null,
        scores: [2, 0],
      }),
    });

    expect(useStore.getState().view?.vira).toEqual(oldVira);
    expect(useStore.getState().view?.handCards).toEqual([]);
    expect(useStore.getState().tableHold).not.toBeNull();

    await vi.advanceTimersByTimeAsync(600 + 1600 + 300);
    expect(useStore.getState().view?.vira).toEqual(oldVira);
    expect(useStore.getState().view?.handCards).toEqual([]);
    expect(useStore.getState().banner?.text).toContain("tento");

    await vi.advanceTimersByTimeAsync(2200);
    expect(useStore.getState().view?.vira).toEqual(newVira);
    expect(useStore.getState().view?.handCards).toEqual(nextHand);
    expect(useStore.getState().banner).toBeNull();
  });

  it("também adia o redeal depois de correr / desistir", async () => {
    const oldVira = { rank: "4" as const, suit: "paus" as const };
    const newVira = { rank: "5" as const, suit: "copas" as const };

    useStore.getState().handleSnapshot({
      ...snapWith([]),
      view: baseView({
        handNumber: 1,
        vira: oldVira,
        handCards: [
          { rank: "6", suit: "ouros" },
          { rank: "7", suit: "paus" },
        ],
      }),
    });

    useStore.getState().handleSnapshot({
      ...snapWith([
        {
          type: "trucoRan",
          seat: 1,
          winnerTeam: 0,
          tentos: 1,
        },
        handFinished,
        {
          type: "handStarted",
          handNumber: 2,
          dealerSeat: 1,
          vira: newVira,
        },
      ]),
      view: baseView({
        handNumber: 2,
        vira: newVira,
        handCards: [
          { rank: "3", suit: "paus" },
          { rank: "2", suit: "copas" },
          { rank: "A", suit: "espadas" },
        ],
        completedVazas: [],
        scores: [2, 0],
      }),
    });

    expect(useStore.getState().view?.vira).toEqual(oldVira);
    expect(useStore.getState().view?.handCards).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(useStore.getState().view?.vira).toEqual(newVira);
    expect(useStore.getState().view?.handCards).toHaveLength(3);
  });
});

describe("store — log do console", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().reset();
    useStore.setState({ screen: "mesa", nickname: "Ana" });
  });

  afterEach(() => {
    useStore.getState().reset();
    vi.useRealTimers();
  });

  it("espelha log do servidor e não apaga quando snapshot omite log", () => {
    const log1 = [
      {
        kind: "event" as const,
        t: 1,
        event: {
          type: "handStarted" as const,
          handNumber: 1,
          dealerSeat: 0,
          vira: { rank: "7" as const, suit: "paus" as const },
        },
      },
    ];
    const log2 = [
      ...log1,
      {
        kind: "chat" as const,
        t: 2,
        seat: 0,
        text: "oi",
      },
    ];

    useStore.getState().handleSnapshot({ ...snapWith([]), log: log1 });
    expect(useStore.getState().log).toEqual(log1);

    useStore.getState().handleSnapshot({ ...snapWith([]), log: log2 });
    expect(useStore.getState().log).toEqual(log2);

    useStore.getState().handleSnapshot(snapWith([])); // sem log
    expect(useStore.getState().log).toEqual(log2);
  });
});
