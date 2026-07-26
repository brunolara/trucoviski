import { describe, it, expect } from "vitest";
import { botAdvice } from "@trucoviski/server";
import type { PlayerView, Card } from "@trucoviski/engine";

describe("botAdvice", () => {
  const defaultVira: Card = { suit: "paus", rank: "4" }; // manilha is '5'

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

  it("advises accept with manilha in hand", () => {
    const view: PlayerView = {
      ...baseView,
      mySeat: 0,
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
    expect(botAdvice(view)).toBe("Aceita! Tenho carta.");
  });

  it("advises run with weak hand (4/5/6)", () => {
    const view: PlayerView = {
      ...baseView,
      mySeat: 0,
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
    expect(botAdvice(view)).toBe("Corre, tô sem nada.");
  });

  it("advises play on elevenDecision with strong pair", () => {
    const view: PlayerView = {
      ...baseView,
      mySeat: 0,
      isElevenHand: true,
      handCards: [{ suit: "paus", rank: "5" }],
      partnerCards: [{ suit: "copas", rank: "5" }],
      legalActions: [
        { type: "elevenDecision", decision: "play" },
        { type: "elevenDecision", decision: "run" },
      ],
    };
    expect(botAdvice(view)).toBe("Joga! Nossas cartas prestam.");
  });

  it("uses different persona phrases for different seats", () => {
    const hand = {
      trucoPendingTeam: 1 as const,
      trucoPendingValue: 3,
      handCards: [
        { suit: "paus" as const, rank: "5" as const },
        { suit: "copas" as const, rank: "5" as const },
        { suit: "espadas" as const, rank: "5" as const },
      ],
      legalActions: [
        { type: "truco" as const, action: "accept" as const },
        { type: "truco" as const, action: "run" as const },
      ],
    };
    const seat0 = botAdvice({ ...baseView, ...hand, mySeat: 0 });
    const seat1 = botAdvice({ ...baseView, ...hand, mySeat: 1 });
    expect(seat0).toBe("Aceita! Tenho carta.");
    expect(seat1).toBe("Aceita isso, parceiro!");
    expect(seat0).not.toBe(seat1);
  });

  it("returns null when only playCard is legal", () => {
    const view: PlayerView = {
      ...baseView,
      handCards: [{ suit: "ouros", rank: "4" }],
      legalActions: [{ type: "playCard", card: { suit: "ouros", rank: "4" } }],
    };
    expect(botAdvice(view)).toBeNull();
  });
});
