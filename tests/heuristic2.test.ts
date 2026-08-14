import { describe, it, expect } from "vitest";
import { createDeck } from "@trucoviski/engine";
import type { PlayerView, Card } from "@trucoviski/engine";
import {
  decideHeuristicV2Action,
  V3_FEATURES,
} from "../packages/bots/src/heuristic2.js";
import {
  getCardStrength,
  strongerCardsRemaining,
  strongerCardsRemainingThanStrength,
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

  it("limiar numérico não reconstrói a manilha a partir de RANKS", () => {
    const viraA: Card = { suit: "paus", rank: "A" };
    const seen = [viraA];
    // 4 três (força 9) + 4 manilhas 2 (10–13) = 8 cartas > 8
    expect(strongerCardsRemainingThanStrength(8, viraA, seen)).toBe(8);
    const fakeTwo: Card = { rank: "2", suit: "ouros" };
    expect(getCardStrength(fakeTwo, viraA)).toBe(10);
    expect(strongerCardsRemaining(fakeTwo, viraA, seen)).toBe(3);

    const viraTwo: Card = { suit: "paus", rank: "2" };
    const copas: Card = { suit: "copas", rank: "3" };
    expect(getCardStrength(copas, viraTwo)).toBe(12);
    expect(
      strongerCardsRemainingThanStrength(12, viraTwo, [viraTwo, copas]),
    ).toBe(1);
  });
});

describe("hiddenCardOutsideFerro flag (E2/T1)", () => {
  const vira: Card = { suit: "paus", rank: "4" };
  const midRng = () => 0.5;
  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    handCards: [],
    vira,
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
  const wonFirst = () => ({
    plays: [
      { suit: "paus", rank: "6" },
      { suit: "copas", rank: "7" },
      { suit: "ouros", rank: "Q" },
      { suit: "espadas", rank: "J" },
    ],
    covered: [false, false, false, false],
    winner: 0,
    tiedSeats: [],
  });
  const flagOn = {
    ...V3_FEATURES,
    vazaPlanning: false,
    hiddenCardOutsideFerro: true,
  };
  const flagOff = {
    ...V3_FEATURES,
    vazaPlanning: false,
    hiddenCardOutsideFerro: false,
  };

  it("cobre a carta mais forte quando o parceiro já vence a vaza", () => {
    const zap: Card = { suit: "paus", rank: "5" };
    const four: Card = { suit: "ouros", rank: "4" };
    const view: PlayerView = {
      ...baseView,
      completedVazas: [wonFirst()],
      currentVaza: {
        plays: [
          null,
          { suit: "espadas", rank: "7" },
          { suit: "copas", rank: "5" },
          { suit: "copas", rank: "Q" },
        ],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: zap },
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playHiddenCard",
      cardIndex: 1,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("cobre a carta mais forte quando não consegue vencer a vaza", () => {
    const zap: Card = { suit: "paus", rank: "5" };
    const three: Card = { suit: "copas", rank: "3" };
    const four: Card = { suit: "ouros", rank: "4" };
    const view: PlayerView = {
      ...baseView,
      completedVazas: [wonFirst()],
      currentVaza: {
        plays: [null, zap, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, three],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: three },
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playHiddenCard",
      cardIndex: 1,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("continua vencendo com a carta mínima quando pode vencer (flag on)", () => {
    const ace: Card = { suit: "paus", rank: "A" };
    const three: Card = { suit: "copas", rank: "3" };
    const view: PlayerView = {
      ...baseView,
      completedVazas: [wonFirst()],
      currentVaza: {
        plays: [null, { suit: "espadas", rank: "7" }, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [three, ace],
      legalActions: [
        { type: "playCard", card: three },
        { type: "playCard", card: ace },
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: ace,
    });
  });
});

describe("rngTieBreak / ferroRandomIndex flags (E2/T8+T6)", () => {
  const vira: Card = { suit: "paus", rank: "4" };
  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    handCards: [],
    vira,
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
  const fourOuros: Card = { suit: "ouros", rank: "4" };
  const fourCopas: Card = { suit: "copas", rank: "4" };
  const seven: Card = { suit: "ouros", rank: "7" };
  const flagOn = {
    ...V3_FEATURES,
    rngTieBreak: true,
    ferroRandomIndex: true,
  };
  const flagOff = {
    ...V3_FEATURES,
    rngTieBreak: false,
    ferroRandomIndex: false,
  };

  it("T8: dois 4s empatados não caem sempre no primeiro quando a flag está ligada", () => {
    const view: PlayerView = {
      ...baseView,
      handCards: [fourOuros, fourCopas, seven],
      legalActions: [
        { type: "playCard", card: fourOuros },
        { type: "playCard", card: fourCopas },
        { type: "playCard", card: seven },
      ],
    };
    const low = decideHeuristicV2Action(view, () => 0.1, flagOn);
    const high = decideHeuristicV2Action(view, () => 0.9, flagOn);
    expect(low).toEqual({ type: "playCard", card: fourOuros });
    expect(high).toEqual({ type: "playCard", card: fourCopas });
    expect(decideHeuristicV2Action(view, () => 0.9, flagOff)).toEqual({
      type: "playCard",
      card: fourOuros,
    });
  });

  it("T8: carta mais fraca única não consome rng", () => {
    const view: PlayerView = {
      ...baseView,
      handCards: [fourOuros, seven],
      legalActions: [
        { type: "playCard", card: fourOuros },
        { type: "playCard", card: seven },
      ],
    };
    const boom = (): number => {
      throw new Error("rng não deve ser chamado com carta única mais fraca");
    };
    expect(decideHeuristicV2Action(view, boom, flagOn)).toEqual({
      type: "playCard",
      card: fourOuros,
    });
  });

  it("T6: ferro escolhe índice por rng; flag off sempre 0", () => {
    const view: PlayerView = {
      ...baseView,
      isFerro: true,
      isElevenHand: true,
      scores: [11, 11],
      handCards: [],
      legalActions: [
        { type: "playHiddenCard", cardIndex: 0 },
        { type: "playHiddenCard", cardIndex: 1 },
        { type: "playHiddenCard", cardIndex: 2 },
      ],
    };
    expect(decideHeuristicV2Action(view, () => 0.05, flagOn)).toEqual({
      type: "playHiddenCard",
      cardIndex: 0,
    });
    expect(decideHeuristicV2Action(view, () => 0.95, flagOn)).toEqual({
      type: "playHiddenCard",
      cardIndex: 2,
    });
    expect(decideHeuristicV2Action(view, () => 0.95, flagOff)).toEqual({
      type: "playHiddenCard",
      cardIndex: 0,
    });
  });
});

describe("openingProfile flag (E2/T2)", () => {
  const vira: Card = { suit: "paus", rank: "4" };
  const midRng = () => 0.5;
  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    handCards: [],
    vira,
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
  const lostFirst = () => ({
    plays: [
      { suit: "paus", rank: "6" },
      { suit: "copas", rank: "7" },
      { suit: "ouros", rank: "Q" },
      { suit: "espadas", rank: "J" },
    ],
    covered: [false, false, false, false],
    winner: 1,
    tiedSeats: [],
  });
  const flagOn = {
    ...V3_FEATURES,
    vazaPlanning: false,
    openingProfile: true,
  };
  const flagOff = {
    ...V3_FEATURES,
    vazaPlanning: false,
    openingProfile: false,
  };

  it("abre forte quando carrega a carta mais forte viva (holdsTopAlive)", () => {
    const zap: Card = { suit: "paus", rank: "5" };
    const four: Card = { suit: "ouros", rank: "4" };
    const seven: Card = { suit: "espadas", rank: "7" };
    const view: PlayerView = {
      ...baseView,
      handCards: [four, seven, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: seven },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: zap,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("abre forte quando precisa ganhar as duas vazas restantes (mustWinBoth)", () => {
    const three: Card = { suit: "copas", rank: "3" };
    const four: Card = { suit: "ouros", rank: "4" };
    const seven: Card = { suit: "espadas", rank: "7" };
    const view: PlayerView = {
      ...baseView,
      completedVazas: [lostFirst()],
      handCards: [four, seven, three],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: seven },
        { type: "playCard", card: three },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: three,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("empate de força preserva a primeira ação (determinístico)", () => {
    const acePaus: Card = { suit: "paus", rank: "A" };
    const aceCopas: Card = { suit: "copas", rank: "A" };
    const four: Card = { suit: "ouros", rank: "4" };
    const view: PlayerView = {
      ...baseView,
      completedVazas: [lostFirst()],
      handCards: [acePaus, aceCopas, four],
      legalActions: [
        { type: "playCard", card: acePaus },
        { type: "playCard", card: aceCopas },
        { type: "playCard", card: four },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: acePaus,
    });
  });
});

describe("winMargin flag (E2/T3)", () => {
  const vira: Card = { suit: "paus", rank: "4" };
  const midRng = () => 0.5;
  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    handCards: [],
    vira,
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
  const lostFirst = () => ({
    plays: [
      { suit: "paus", rank: "6" },
      { suit: "copas", rank: "7" },
      { suit: "ouros", rank: "Q" },
      { suit: "espadas", rank: "J" },
    ],
    covered: [false, false, false, false],
    winner: 1,
    tiedSeats: [],
  });
  const wonFirst = () => ({
    plays: [
      { suit: "paus", rank: "6" },
      { suit: "copas", rank: "7" },
      { suit: "ouros", rank: "Q" },
      { suit: "espadas", rank: "J" },
    ],
    covered: [false, false, false, false],
    winner: 0,
    tiedSeats: [],
  });
  const flagOn = { ...V3_FEATURES, vazaPlanning: false, winMargin: true };
  const flagOff = { ...V3_FEATURES, vazaPlanning: false, winMargin: false };
  const zap: Card = { suit: "paus", rank: "5" };
  const copas: Card = { suit: "copas", rank: "5" };
  const seven: Card = { suit: "ouros", rank: "7" };
  const four: Card = { suit: "ouros", rank: "4" };
  const six: Card = { suit: "espadas", rank: "6" };
  const three: Card = { suit: "copas", rank: "3" };
  const ace: Card = { suit: "paus", rank: "A" };

  it("na 1ª vaza gasta a coberta (zap) quando a mínima não cobre", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, six, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, seven, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: seven },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: zap,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: seven,
    });
  });

  it("sendo o último ainda ganha pela mínima (a vaza já está coberta)", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [
          null,
          six,
          { suit: "copas", rank: "4" },
          { suit: "espadas", rank: "4" },
        ],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [seven, zap],
      legalActions: [
        { type: "playCard", card: seven },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: seven,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: seven,
    });
  });

  it("na 1ª vaza descarta lixo quando nenhuma vencedora cobre", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, seven, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, ace, three],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: ace },
        { type: "playCard", card: three },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: four,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: ace,
    });
  });

  it("mustWinBoth: joga a maior quando a mínima não cobre", () => {
    const view: PlayerView = {
      ...baseView,
      completedVazas: [lostFirst()],
      currentVaza: {
        plays: [null, seven, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [ace, three],
      legalActions: [
        { type: "playCard", card: ace },
        { type: "playCard", card: three },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: three,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: ace,
    });
  });

  it("depois de ganhar a 1ª, continua na mínima (só falta uma vaza)", () => {
    const view: PlayerView = {
      ...baseView,
      completedVazas: [wonFirst()],
      currentVaza: {
        plays: [null, six, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [seven, zap],
      legalActions: [
        { type: "playCard", card: seven },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: seven,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: seven,
    });
  });

  it("gasta a coberta mais barata (copas, não zap) quando a min não cobre", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, six, null, null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [seven, copas, zap],
      legalActions: [
        { type: "playCard", card: seven },
        { type: "playCard", card: copas },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: copas,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: seven,
    });
  });
});

describe("partnerFolgaDiscard flag (E2/T5)", () => {
  const vira: Card = { suit: "paus", rank: "4" };
  const midRng = () => 0.5;
  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    handCards: [],
    vira,
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
  const flagOn = {
    ...V3_FEATURES,
    vazaPlanning: false,
    partnerFolgaDiscard: true,
  };
  const flagOff = {
    ...V3_FEATURES,
    vazaPlanning: false,
    partnerFolgaDiscard: false,
  };
  const zap: Card = { suit: "paus", rank: "5" };
  const copas: Card = { suit: "copas", rank: "5" };
  const four: Card = { suit: "ouros", rank: "4" };
  const ace: Card = { suit: "paus", rank: "A" };
  const queen: Card = { suit: "espadas", rank: "Q" };
  const three: Card = { suit: "copas", rank: "3" };
  const seven: Card = { suit: "ouros", rank: "7" };
  const six: Card = { suit: "copas", rank: "6" };

  it("sem folga tranca com a coberta (zap) em vez de descartar", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, null, ace, queen],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: zap,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("sem folga gasta a coberta mais barata (copas, não zap)", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, null, ace, queen],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, copas, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: copas },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: copas,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("não come o 3 do parceiro: ameaça só de manilha, descarta lixo", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, null, three, queen],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: four,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("sendo o último ainda descarta (a vaza já está ganha)", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, six, seven, four],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: four,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });

  it("com folga (parceiro tem a mais forte viva) não come a carta dele", () => {
    const view: PlayerView = {
      ...baseView,
      currentVaza: {
        plays: [null, null, copas, queen],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
      handCards: [four, zap],
      legalActions: [
        { type: "playCard", card: four },
        { type: "playCard", card: zap },
      ],
    };
    expect(decideHeuristicV2Action(view, midRng, flagOn)).toEqual({
      type: "playCard",
      card: four,
    });
    expect(decideHeuristicV2Action(view, midRng, flagOff)).toEqual({
      type: "playCard",
      card: four,
    });
  });
});
