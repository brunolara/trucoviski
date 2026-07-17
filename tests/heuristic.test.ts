import { describe, it, expect } from "vitest";
import { decideHeuristicAction } from "../packages/bots/src/heuristic.js";
import type { PlayerView, Card } from "@trucoviski/engine";

describe("Heuristic Bot Strategy (F4)", () => {
  const defaultVira: Card = { suit: "paus", rank: "4" }; // manilha is '5'

  const baseView: PlayerView = {
    handNumber: 1,
    handCards: [],
    vira: defaultVira,
    completedVazas: [],
    currentVaza: null,
    scores: [0, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions: [],
  };

  describe("playCard decisions", () => {
    it("plays the weakest card when opening a vaza", () => {
      const view: PlayerView = {
        ...baseView,
        handCards: [
          { suit: "copas", rank: "3" }, // strong (9)
          { suit: "ouros", rank: "4" }, // weak (0)
          { suit: "espadas", rank: "A" }, // medium (7)
        ],
        legalActions: [
          { type: "playCard", card: { suit: "copas", rank: "3" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "playCard", card: { suit: "espadas", rank: "A" } },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "ouros", rank: "4" },
      });
    });

    it("plays the cheapest winning card when not opening and partner is not winning", () => {
      const view: PlayerView = {
        ...baseView,
        currentVaza: {
          plays: [
            { suit: "copas", rank: "K" }, // opponent played K (6)
            null,
            null,
            null,
          ],
          currentSeat: 1,
        },
        handCards: [
          { suit: "copas", rank: "3" }, // strong (9) - wins
          { suit: "ouros", rank: "4" }, // weak (0) - loses
          { suit: "espadas", rank: "A" }, // medium (7) - wins (cheaper than 3)
        ],
        legalActions: [
          { type: "playCard", card: { suit: "copas", rank: "3" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "playCard", card: { suit: "espadas", rank: "A" } },
        ],
      };
      const action = decideHeuristicAction(view);
      // K is 6. A is 7, 3 is 9. A is the cheapest winner.
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "espadas", rank: "A" },
      });
    });

    it("discards the weakest card when cannot win", () => {
      const view: PlayerView = {
        ...baseView,
        currentVaza: {
          plays: [
            { suit: "copas", rank: "3" }, // opponent played 3 (9)
            null,
            null,
            null,
          ],
          currentSeat: 1,
        },
        handCards: [
          { suit: "copas", rank: "Q" }, // (4) - loses
          { suit: "ouros", rank: "4" }, // (0) - loses
          { suit: "espadas", rank: "A" }, // (7) - loses
        ],
        legalActions: [
          { type: "playCard", card: { suit: "copas", rank: "Q" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "playCard", card: { suit: "espadas", rank: "A" } },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "ouros", rank: "4" },
      });
    });

    it("discards the weakest card when partner is winning and we are last to play", () => {
      const view: PlayerView = {
        ...baseView,
        currentVaza: {
          plays: [
            { suit: "copas", rank: "Q" }, // seat 0
            { suit: "ouros", rank: "4" }, // seat 1
            { suit: "copas", rank: "3" }, // seat 2 (partner - winning with 3)
            null, // seat 3 (us)
          ],
          currentSeat: 3,
        },
        handCards: [
          { suit: "copas", rank: "K" },
          { suit: "ouros", rank: "4" },
        ],
        legalActions: [
          { type: "playCard", card: { suit: "copas", rank: "K" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "ouros", rank: "4" },
      });
    });
  });

  describe("elevenDecision", () => {
    it("chooses to play if team has strong cards", () => {
      const view: PlayerView = {
        ...baseView,
        isElevenHand: true,
        handCards: [{ suit: "copas", rank: "3" }],
        partnerCards: [
          { suit: "ouros", rank: "5" }, // manilha (10)
        ],
        legalActions: [
          { type: "elevenDecision", decision: "play" },
          { type: "elevenDecision", decision: "run" },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({ type: "elevenDecision", decision: "play" });
    });

    it("chooses to run if team has only weak cards", () => {
      const view: PlayerView = {
        ...baseView,
        isElevenHand: true,
        handCards: [{ suit: "copas", rank: "4" }],
        partnerCards: [{ suit: "ouros", rank: "4" }],
        legalActions: [
          { type: "elevenDecision", decision: "play" },
          { type: "elevenDecision", decision: "run" },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({ type: "elevenDecision", decision: "run" });
    });
  });

  describe("truco decisions", () => {
    it("accepts truco if we have a strong card", () => {
      const view: PlayerView = {
        ...baseView,
        trucoPendingTeam: 1,
        handCards: [
          { suit: "copas", rank: "3" }, // 9 (strong)
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({ type: "truco", action: "accept" });
    });

    it("runs from truco if hand is weak", () => {
      const view: PlayerView = {
        ...baseView,
        trucoPendingTeam: 1,
        handCards: [
          { suit: "copas", rank: "4" }, // 0
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const action = decideHeuristicAction(view);
      expect(action).toEqual({ type: "truco", action: "run" });
    });
  });
});
