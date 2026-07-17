import { describe, it, expect } from "vitest";
import { decideMonteCarloAction } from "../packages/bots/src/montecarlo.js";
import { runArena, createPRNG } from "@trucoviski/engine";
import type { PlayerView, Card } from "@trucoviski/engine";

describe("Monte Carlo Bot (F3)", () => {
  const defaultVira: Card = { suit: "paus", rank: "4" };

  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 0,
    handCards: [],
    vira: defaultVira,
    completedVazas: [],
    currentVaza: null,
    scores: [0, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions: [],
  };

  it("returns null when there are no legal actions", () => {
    const action = decideMonteCarloAction({ ...baseView, legalActions: [] });
    expect(action).toBeNull();
  });

  it("returns the single legal action directly without sampling", () => {
    const view: PlayerView = {
      ...baseView,
      legalActions: [{ type: "truco", action: "run" }],
    };
    const action = decideMonteCarloAction(view);
    expect(action).toEqual({ type: "truco", action: "run" });
  });

  it("always picks one of the legal actions (never fabricates an action)", () => {
    const rng = createPRNG(7);
    const view: PlayerView = {
      ...baseView,
      mySeat: 2,
      dealerSeat: 1,
      completedVazas: [
        {
          plays: [
            { suit: "copas", rank: "6" },
            { suit: "ouros", rank: "7" },
            null,
            null,
          ],
          covered: [false, false, true, true],
          winner: 1,
          tiedSeats: [],
        },
      ],
      handCards: [
        { suit: "espadas", rank: "A" },
        { suit: "copas", rank: "K" },
      ],
      legalActions: [
        { type: "playCard", card: { suit: "espadas", rank: "A" } },
        { type: "playCard", card: { suit: "copas", rank: "K" } },
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
        { type: "surrender" },
      ],
    };
    const action = decideMonteCarloAction(view, {
      samples: 20,
      rng: () => rng.next(),
    });
    expect(view.legalActions).toContainEqual(action);
  });

  it("beats a random policy decisively over many games", () => {
    const rng = createPRNG(11);
    const result = runArena({
      games: 60,
      seed: 5,
      policyTeam0: (v) =>
        decideMonteCarloAction(v, { samples: 30, rng: () => rng.next() }),
      policyTeam1: () => null, // política aleatória (fallback do runArena)
    });
    expect(result.errors).toEqual([]);
    expect(result.winRateTeam0).toBeGreaterThan(0.8);
  });
});
