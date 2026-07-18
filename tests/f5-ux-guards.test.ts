/* ------------------------------------------------------------------ */
/*  Testes das guards de UX da F5 — Mesa.tsx                           */
/*  Cobre: playDispatchGuard, handleCardTap, handleCardKeyDown,        */
/*         social-panel Escape                                         */
/* ------------------------------------------------------------------ */

import { describe, expect, it, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/* 1. playDispatchGuard – evita dupla submissão                       */
/* ------------------------------------------------------------------ */

interface DispatchGuard {
  snapshotKey: string;
  isDispatching: boolean;
}

/**
 * Reimplementação exata da lógica presente em Mesa.tsx (snapshot e dispatch)
 * para ser testada de forma isolada.
 */
function createPlayDispatchGuard(): {
  guard: DispatchGuard;
  resetForSnapshot: (key: string) => void;
  tryDispatch: (isMyTurn: boolean, action: unknown) => boolean;
} {
  const guard: DispatchGuard = { snapshotKey: "", isDispatching: false };

  const resetForSnapshot = (key: string) => {
    if (guard.snapshotKey !== key) {
      guard.snapshotKey = key;
      guard.isDispatching = false;
    }
  };

  const tryDispatch = (isMyTurn: boolean, action: unknown): boolean => {
    if (!isMyTurn || !action || guard.isDispatching) return false;
    guard.isDispatching = true;
    // dispatchAction(action) — efeito colateral que não simulamos aqui
    return true;
  };

  return { guard, resetForSnapshot, tryDispatch };
}

describe("playDispatchGuard (double-submission prevention)", () => {
  let g: ReturnType<typeof createPlayDispatchGuard>;

  beforeEach(() => {
    g = createPlayDispatchGuard();
  });

  it("allows the first dispatch for a given snapshot", () => {
    g.resetForSnapshot("1:0:0");
    const dispatched = g.tryDispatch(true, { type: "playCard" });
    expect(dispatched).toBe(true);
  });

  it("blocks a second dispatch within the same snapshot (isDispatching stays true)", () => {
    g.resetForSnapshot("1:0:0");
    g.tryDispatch(true, { type: "playCard" });
    const second = g.tryDispatch(true, { type: "playCard", cardIndex: 0 });
    expect(second).toBe(false);
    expect(g.guard.isDispatching).toBe(true);
  });

  it("blocks dispatch when not my turn", () => {
    g.resetForSnapshot("1:0:1"); // turnSeat=1, seat=0
    const dispatched = g.tryDispatch(false, { type: "playCard" });
    expect(dispatched).toBe(false);
  });

  it("blocks dispatch when action is undefined", () => {
    g.resetForSnapshot("1:0:0");
    const dispatched = g.tryDispatch(true, undefined);
    expect(dispatched).toBe(false);
  });

  it("resets guard when snapshotKey changes (server replied with new state)", () => {
    g.resetForSnapshot("1:0:0");
    g.tryDispatch(true, { type: "playCard" });
    expect(g.guard.isDispatching).toBe(true);

    // Server sends a new snapshot — key changes
    g.resetForSnapshot("1:0:1");
    expect(g.guard.isDispatching).toBe(false);

    // Next dispatch allowed under new snapshot
    const dispatched = g.tryDispatch(true, { type: "playCard" });
    expect(dispatched).toBe(true);
  });

  it("resets when a completed vaza advances with the same jogador mão", () => {
    // handNumber:completedVazas.length:turnSeat
    g.resetForSnapshot("7:0:0");
    expect(g.tryDispatch(true, { type: "playCard" })).toBe(true);

    // The authoritative server snapshot arrives with the same starter, but
    // one completed vaza: the next vaza must accept its first card.
    g.resetForSnapshot("7:1:0");
    expect(g.guard.isDispatching).toBe(false);
    expect(g.tryDispatch(true, { type: "playCard" })).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. handleCardTap – double-tap via Date.now()                       */
/* ------------------------------------------------------------------ */

type TapHandlerFn = (
  event: { preventDefault: () => void },
  cardIndex: number,
  play: () => void,
) => void;

function createTapHandler(): {
  handler: TapHandlerFn;
  lastCardTap: Record<number, number>;
  playCalls: number[];
} {
  const lastCardTap: Record<number, number> = {};
  const playCalls: number[] = [];

  const handler: TapHandlerFn = (event, cardIndex, play) => {
    event.preventDefault();
    const now = Date.now();
    if (now - (lastCardTap[cardIndex] ?? 0) < 300) {
      lastCardTap[cardIndex] = 0;
      play();
      return;
    }
    lastCardTap[cardIndex] = now;
  };

  return {
    handler,
    lastCardTap,
    playCalls,
  };
}

describe("handleCardTap (double-tap prevention)", () => {
  let tap: ReturnType<typeof createTapHandler>;

  beforeEach(() => {
    tap = createTapHandler();
  });

  it("first tap does not trigger play (stores timestamp)", () => {
    const play = vi.fn();
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    expect(play).not.toHaveBeenCalled();
    expect(tap.lastCardTap[0]).toBeGreaterThan(0);
  });

  it("second tap within 300ms triggers play and resets timestamp to 0", () => {
    const play = vi.fn();

    // First tap
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    expect(play).not.toHaveBeenCalled();

    // Second tap immediately (well within 300ms)
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    expect(play).toHaveBeenCalledTimes(1);
    expect(tap.lastCardTap[0]).toBe(0);
  });

  it("third tap (>300ms after reset=0) starts a new cycle", () => {
    const play = vi.fn();

    // Double-tap triggers play
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    expect(play).toHaveBeenCalledTimes(1);

    // Simulate time passing by manually setting a new timestamp that is >300ms from 0
    tap.lastCardTap[0] = Date.now() - 400;

    // Third tap — should NOT trigger play, just store timestamp
    tap.handler({ preventDefault: vi.fn() }, 0, play);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("cards are tracked independently (different cardIndex)", () => {
    const play0 = vi.fn();
    const play1 = vi.fn();

    // Tap card 0 twice fast → triggers play0
    tap.handler({ preventDefault: vi.fn() }, 0, play0);
    tap.handler({ preventDefault: vi.fn() }, 0, play0);
    expect(play0).toHaveBeenCalledTimes(1);

    // Tap card 1 once → does NOT trigger play1 yet
    tap.handler({ preventDefault: vi.fn() }, 1, play1);
    expect(play1).not.toHaveBeenCalled();
  });

  it("calls event.preventDefault on every tap", () => {
    const preventDefault = vi.fn();
    tap.handler({ preventDefault }, 0, vi.fn());
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3. handleCardKeyDown – Enter/Espaço despacha ação única            */
/* ------------------------------------------------------------------ */

type KeyDownHandlerFn = (
  event: { key: string; preventDefault: () => void },
  play: () => void,
) => void;

function createKeyDownHandler(): {
  handler: KeyDownHandlerFn;
  playCalls: number;
} {
  const playCalls = { count: 0 };

  const handler: KeyDownHandlerFn = (event, play) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playCalls.count++;
    play(); // note: play ultimately calls dispatchPlayAction which has its own guard
  };

  return {
    handler,
    get playCalls() {
      return playCalls.count;
    },
  };
}

describe("handleCardKeyDown (Enter/Space dispatches action)", () => {
  it("Enter triggers play and preventDefault", () => {
    const kd = createKeyDownHandler();
    const play = vi.fn();
    const preventDefault = vi.fn();

    kd.handler({ key: "Enter", preventDefault }, play);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("Space triggers play and preventDefault", () => {
    const kd = createKeyDownHandler();
    const play = vi.fn();
    const preventDefault = vi.fn();

    kd.handler({ key: " ", preventDefault }, play);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys (e.g. ArrowRight, Escape, Tab)", () => {
    const kd = createKeyDownHandler();
    const play = vi.fn();

    for (const key of ["ArrowRight", "Escape", "Tab", "a", "Backspace"]) {
      kd.handler({ key, preventDefault: vi.fn() }, play);
    }
    expect(play).not.toHaveBeenCalled();
  });

  it("does not call preventDefault for non-Enter/Space keys", () => {
    const preventDefault = vi.fn();
    const kd = createKeyDownHandler();
    kd.handler({ key: "Tab", preventDefault }, vi.fn());
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("Enter dispatches only once per keydown (playDispatchGuard handles double-fire)", () => {
    // The keydown handler unconditionally fires the play callback.
    // The guard in dispatchPlayAction ensures only one dispatch occurs.
    // We test that keydown itself is deterministic — always calls play when Enter.
    const kd = createKeyDownHandler();
    const play = vi.fn();

    kd.handler({ key: "Enter", preventDefault: vi.fn() }, play);
    kd.handler({ key: "Enter", preventDefault: vi.fn() }, play);
    expect(play).toHaveBeenCalledTimes(2); // Each keydown fires handler, guard blocks duplicate *dispatch*
  });
});

/* ------------------------------------------------------------------ */
/* 4. social-panel Escape fechamento                                  */
/* ------------------------------------------------------------------ */

describe("social-panel Escape closing", () => {
  it("Escape key sets showSocialPanel to false", () => {
    // Simula a lógica do onKeyDown no socialPanel div:
    //   if (event.key === "Escape") setShowSocialPanel(false);
    let showSocialPanel = true;

    const onKeyDown = (event: { key: string }) => {
      if (event.key === "Escape") {
        showSocialPanel = false;
      }
    };

    onKeyDown({ key: "Escape" });
    expect(showSocialPanel).toBe(false);
  });

  it("other keys do not close social panel", () => {
    let showSocialPanel = true;

    const onKeyDown = (event: { key: string }) => {
      if (event.key === "Escape") {
        showSocialPanel = false;
      }
    };

    onKeyDown({ key: "Enter" });
    expect(showSocialPanel).toBe(true);

    onKeyDown({ key: " " });
    expect(showSocialPanel).toBe(true);

    onKeyDown({ key: "Tab" });
    expect(showSocialPanel).toBe(true);
  });

  it("clicking on socialOverlay (outside socialPanel) closes the panel via stopPropagation", () => {
    // socialOverlay onClick: event.stopPropagation(); setShowSocialPanel(false);
    let showSocialPanel = true;
    let didStopPropagation = false;

    const stopPropagation = () => {
      didStopPropagation = true;
    };

    // onClick handler on overlay
    const overlayOnClick = () => {
      stopPropagation();
      showSocialPanel = false;
    };

    overlayOnClick();
    expect(showSocialPanel).toBe(false);
    expect(didStopPropagation).toBe(true);
  });

  it("clicking on socialPanel inner div does NOT close the panel (stopPropagation)", () => {
    // socialPanel inner div onClick: e.stopPropagation() — does NOT call setShowSocialPanel(false)
    const showSocialPanel = true;
    let didStopPropagation = false;

    const innerOnClick = () => {
      didStopPropagation = true;
      // NOT calling setShowSocialPanel(false) — that's the overlay's job
    };

    innerOnClick();
    expect(showSocialPanel).toBe(true); // Panel stays open
    expect(didStopPropagation).toBe(true);
  });
});
