import { describe, it, expect } from "vitest";
import { createDeck } from "@trucoviski/engine";
import type { PlayerView, Card } from "@trucoviski/engine";
import { decideHeuristicV2Action } from "../packages/bots/src/heuristic2.js";
import {
  getCardStrength,
  strongerCardsRemaining,
} from "../packages/bots/src/strength.js";

describe("Heuristic Bot v2 (F1+F2)", () => {
  const defaultVira: Card = { suit: "paus", rank: "4" }; // manilha is '5'
  const midRng = () => 0.5;

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
    trucoRaises: [],
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions: [],
  };

  describe("playCard decisions", () => {
    it("opens a vaza with the weakest card", () => {
      const view: PlayerView = {
        ...baseView,
        handCards: [
          { suit: "copas", rank: "3" },
          { suit: "ouros", rank: "4" },
          { suit: "espadas", rank: "A" },
        ],
        legalActions: [
          { type: "playCard", card: { suit: "copas", rank: "3" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "playCard", card: { suit: "espadas", rank: "A" } },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "ouros", rank: "4" },
      });
    });

    it("discards the weakest card when partner is already winning the vaza, even if not last to play", () => {
      const view: PlayerView = {
        ...baseView,
        mySeat: 1, // partner is seat 3
        currentVaza: {
          plays: [
            { suit: "copas", rank: "Q" }, // seat 0
            null, // seat 1 (us, deciding now)
            { suit: "ouros", rank: "4" }, // seat 2
            { suit: "copas", rank: "3" }, // seat 3 (partner) — winning
          ],
          covered: [false, false, false, false],
          currentSeat: 1,
        },
        handCards: [
          { suit: "espadas", rank: "A" },
          { suit: "ouros", rank: "4" },
        ],
        legalActions: [
          { type: "playCard", card: { suit: "espadas", rank: "A" } },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "ouros", rank: "4" },
      });
    });

    it("prefers tying (canga) over winning the 2nd vaza after already winning the 1st", () => {
      const view: PlayerView = {
        ...baseView,
        mySeat: 0,
        completedVazas: [
          {
            plays: [
              { suit: "ouros", rank: "4" },
              { suit: "copas", rank: "5" },
              null,
              null,
            ],
            covered: [false, false, true, true],
            winner: 0,
            tiedSeats: [],
          },
        ],
        currentVaza: {
          plays: [null, { suit: "copas", rank: "Q" }, null, null],
          covered: [false, false, false, false],
          currentSeat: 0,
        },
        handCards: [
          { suit: "espadas", rank: "Q" }, // ties with copas Q (same rank, not manilha)
          { suit: "paus", rank: "A" }, // would win outright
        ],
        legalActions: [
          { type: "playCard", card: { suit: "espadas", rank: "Q" } },
          { type: "playCard", card: { suit: "paus", rank: "A" } },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({
        type: "playCard",
        card: { suit: "espadas", rank: "Q" },
      });
    });
  });

  describe("truco decisions", () => {
    it("accepts truco with an overwhelming hand (triple manilha)", () => {
      const view: PlayerView = {
        ...baseView,
        trucoPendingTeam: 1,
        trucoPendingValue: 3,
        handCards: [
          { suit: "paus", rank: "5" },
          { suit: "copas", rank: "5" },
          { suit: "espadas", rank: "5" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({ type: "truco", action: "accept" });
    });

    it("runs from truco with a hopeless hand (three weakest cards)", () => {
      const view: PlayerView = {
        ...baseView,
        trucoPendingTeam: 1,
        trucoPendingValue: 3,
        handCards: [
          { suit: "ouros", rank: "4" },
          { suit: "espadas", rank: "4" },
          { suit: "copas", rank: "6" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({ type: "truco", action: "run" });
    });

    it("accepts truco when it already holds the strongest card still alive", () => {
      // vira ouros-4 → manilha rank "5"; paus-5 is the top manilha (strength 13).
      const view: PlayerView = {
        ...baseView,
        vira: { suit: "ouros", rank: "4" },
        trucoPendingTeam: 1,
        trucoPendingValue: 3,
        handCards: [
          { suit: "paus", rank: "5" }, // zap
          { suit: "ouros", rank: "6" },
          { suit: "espadas", rank: "6" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({ type: "truco", action: "accept" });
    });
  });

  describe("elevenDecision", () => {
    it("plays with a strong team hand", () => {
      const view: PlayerView = {
        ...baseView,
        isElevenHand: true,
        handCards: [{ suit: "paus", rank: "5" }],
        partnerCards: [{ suit: "copas", rank: "5" }],
        legalActions: [
          { type: "elevenDecision", decision: "play" },
          { type: "elevenDecision", decision: "run" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({ type: "elevenDecision", decision: "play" });
    });

    it("runs with a hopeless team hand", () => {
      const view: PlayerView = {
        ...baseView,
        isElevenHand: true,
        handCards: [{ suit: "ouros", rank: "4" }],
        partnerCards: [{ suit: "espadas", rank: "4" }],
        legalActions: [
          { type: "elevenDecision", decision: "play" },
          { type: "elevenDecision", decision: "run" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action).toEqual({ type: "elevenDecision", decision: "run" });
    });
  });

  describe("surrender", () => {
    it("never proactively surrenders when other actions are legal", () => {
      const view: PlayerView = {
        ...baseView,
        handCards: [{ suit: "ouros", rank: "4" }],
        legalActions: [
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "surrender" },
        ],
      };
      const action = decideHeuristicV2Action(view, midRng);
      expect(action?.type).toBe("playCard");
    });
  });
});

describe("strongerCardsRemaining", () => {
  function reference(card: Card, vira: Card, seen: readonly Card[]): number {
    const key = (c: Card) => `${c.suit}-${c.rank}`;
    const seenKeys = new Set(seen.map(key));
    const s = getCardStrength(card, vira);
    return createDeck().filter(
      (c) => !seenKeys.has(key(c)) && getCardStrength(c, vira) > s,
    ).length;
  }

  it("bate a varredura de baralho em todo o espaço", () => {
    const deck = createDeck();
    for (const vira of deck) {
      for (const card of deck) {
        for (const seen of [[], [vira], [vira, card], deck.slice(0, 7)]) {
          expect(strongerCardsRemaining(card, vira, seen)).toBe(
            reference(card, vira, seen),
          );
        }
      }
    }
  });
});
