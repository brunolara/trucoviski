import { describe, expect, it } from "vitest";
import type { Card, CompletedVaza, PlayerView, Seat } from "@trucoviski/engine";
import { DECK_SIZE } from "@trucoviski/engine";
import { V3_FEATURES } from "../packages/bots/src/heuristic2.js";
import {
  countUnseenCards,
  decidePlannedCardAction,
  evaluateCardRoute,
  resolveVazaOutcomeProbabilities,
  splitWinLoseTie,
} from "../packages/bots/src/planning.js";
import { collectSeenCards } from "../packages/bots/src/strength.js";

const VIRA: Card = { suit: "paus", rank: "4" }; // manilha = 5
const midRng = () => 0.5;

function C(rank: Card["rank"], suit: Card["suit"] = "ouros"): Card {
  return { rank, suit };
}

function completed(winner: Seat | null): CompletedVaza {
  return {
    plays: [null, null, null, null],
    covered: [false, false, false, false],
    winner,
    tiedSeats: winner === null ? [0, 1] : [],
  };
}

function view(
  over: Partial<PlayerView> & Pick<PlayerView, "handCards" | "legalActions">,
): PlayerView {
  return {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    vira: VIRA,
    completedVazas: [],
    currentVaza: null,
    scores: [0, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    ...over,
  };
}

function playActions(cards: readonly Card[]) {
  return cards.map((card) => ({ type: "playCard" as const, card }));
}

function probs(card: Card, v: PlayerView) {
  const seen = collectSeenCards(v);
  return resolveVazaOutcomeProbabilities(
    card,
    v,
    seen,
    Math.max(1, countUnseenCards(seen)),
  );
}

describe("planner: empate da 3ª vaza", () => {
  const ace = C("A", "paus");
  const queen = C("Q", "paus");
  const tableQ1 = C("Q", "copas");
  const tableQ2 = C("Q", "espadas");
  const tableWeak = C("4", "espadas");

  function thirdVazaView(dealerSeat: Seat): PlayerView {
    const hand = [ace, queen];
    return view({
      dealerSeat,
      handCards: hand,
      legalActions: playActions(hand),
      completedVazas: [completed(0), completed(1)],
      currentVaza: {
        plays: [null, tableQ1, tableQ2, tableWeak],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
    });
  }

  it("1x1 com canga na 3ª decide pelo mão, não pelo vencedor da 1ª", () => {
    const v = thirdVazaView(1);
    const action = decidePlannedCardAction(
      v,
      playActions([ace, queen]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: ace });
    expect(evaluateCardRoute(ace, v, V3_FEATURES)).toBeGreaterThan(
      evaluateCardRoute(queen, v, V3_FEATURES),
    );
  });

  it("se o nosso time é o mão, canga na 3ª ganha e prefere a carta mais fraca", () => {
    const v = thirdVazaView(0);
    const action = decidePlannedCardAction(
      v,
      playActions([ace, queen]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: queen });
  });
});

describe("planner: carta coberta", () => {
  const zap = C("5", "paus");
  const four = C("4", "ouros");
  const partnerThree = C("3", "copas");
  const oppQueen = C("Q", "copas");

  const coveredLast = view({
    dealerSeat: 3,
    handCards: [zap, four],
    legalActions: playActions([zap, four]),
    completedVazas: [completed(1)],
    currentVaza: {
      plays: [null, null, partnerThree, oppQueen],
      covered: [false, true, false, false],
      currentSeat: 0,
    },
  });

  it("não trata assento coberto como ainda por jogar", () => {
    expect(probs(four, coveredLast)).toEqual({ pWin: 1, pLose: 0, pTie: 0 });
    const action = decidePlannedCardAction(
      coveredLast,
      playActions([zap, four]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: four });
  });
});

describe("planner: empate cross-team já na mesa", () => {
  const ace = C("A", "paus");
  const four = C("4", "ouros");
  const qOpp = C("Q", "copas");
  const qPartner = C("Q", "espadas");
  const weak = C("7", "paus");

  const tiedTable = view({
    dealerSeat: 3,
    handCards: [ace, four],
    legalActions: playActions([ace, four]),
    completedVazas: [completed(0)],
    currentVaza: {
      plays: [null, qOpp, qPartner, weak],
      covered: [false, false, false, false],
      currentSeat: 0,
    },
  });

  it("carta mais fraca que o empate permanece empate, não derrota", () => {
    expect(probs(four, tiedTable)).toEqual({ pWin: 0, pLose: 0, pTie: 1 });
    expect(probs(ace, tiedTable)).toEqual({ pWin: 1, pLose: 0, pTie: 0 });
    const action = decidePlannedCardAction(
      tiedTable,
      playActions([ace, four]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: four });
  });
});

describe("planner: probabilidades somam 1", () => {
  it("splitWinLoseTie reserva o empate sem estourar 100%", () => {
    const r = splitWinLoseTie(0.5, 0.04);
    expect(r.pTie).toBe(0.04);
    expect(r.pWin).toBeCloseTo(0.48);
    expect(r.pLose).toBeCloseTo(0.48);
    expect(r.pWin + r.pLose + r.pTie).toBeCloseTo(1);
  });

  it("resolveVazaOutcomeProbabilities soma 1 no último a jogar", () => {
    const four = C("4", "ouros");
    const v = view({
      handCards: [four],
      legalActions: playActions([four]),
      currentVaza: {
        plays: [null, C("Q", "copas"), C("Q", "espadas"), C("7", "paus")],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
    });
    const p = probs(four, v);
    expect(p.pWin + p.pLose + p.pTie).toBeCloseTo(1);
  });
});

describe("planner: cartas próprias não saem de novo do unseen", () => {
  const hand = [C("7", "ouros"), C("Q", "copas"), C("A", "espadas")];
  const v = view({
    handCards: hand,
    legalActions: playActions(hand),
  });

  it("candidate já vista na mão não reduz o universo desconhecido", () => {
    const seen = collectSeenCards(v);
    const unseen = countUnseenCards(seen);
    const first = hand[0];
    if (!first) throw new Error("hand vazia");
    expect(unseen).toBe(DECK_SIZE - (1 + hand.length));
    expect(countUnseenCards([...seen, first])).toBe(unseen);
  });
});

describe("planner: canga futura por mesmo rank", () => {
  function lastVazaOurLead(card: Card): PlayerView {
    return view({
      handCards: [card],
      legalActions: playActions([card]),
      completedVazas: [completed(0), completed(1)],
      currentVaza: {
        plays: [null, C("Q", "copas"), C("7", "espadas"), null],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
    });
  }

  it("A nosso + A adversário possível tem P(canga) > 0", () => {
    const ace = C("A", "paus");
    const p = probs(ace, lastVazaOurLead(ace));
    // 1 oponente, 1 carta: 12 mais fortes (2, 3, manilha 5) e 3 As restantes em 36.
    expect(p.pLose).toBeCloseTo(12 / 36);
    expect(p.pTie).toBeCloseTo(3 / 36);
    expect(p.pWin).toBeCloseTo(21 / 36);
    expect(p.pWin + p.pLose + p.pTie).toBeCloseTo(1);
  });

  it("3 nosso + 3 adversário possível tem P(canga) > 0", () => {
    const three = C("3", "paus");
    const p = probs(three, lastVazaOurLead(three));
    // Só manilhas superam o 3; restam 3 três.
    expect(p.pLose).toBeCloseTo(4 / 36);
    expect(p.pTie).toBeCloseTo(3 / 36);
    expect(p.pWin).toBeCloseTo(29 / 36);
  });

  it("manilha nossa não pode empatar", () => {
    const ouro = C("5", "ouros");
    const p = probs(ouro, lastVazaOurLead(ouro));
    expect(p.pTie).toBe(0);
    expect(p.pLose).toBeCloseTo(3 / 36);
    expect(p.pWin).toBeCloseTo(33 / 36);
  });

  it("parceiro ainda joga: carta igual à do oponente pode empatar", () => {
    const four = C("4", "ouros");
    const v = view({
      handCards: [four],
      legalActions: playActions([four]),
      completedVazas: [completed(0), completed(1)],
      currentVaza: {
        plays: [null, C("A", "copas"), null, C("7", "paus")],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
    });
    const p = probs(four, v);
    expect(p.pTie).toBeGreaterThan(0);
    expect(p.pWin + p.pLose + p.pTie).toBeCloseTo(1);
  });
});

describe("planner: bônus de superar oponente", () => {
  it("perdeu a 1ª, parceiro ganhando a 2ª: não ganha bônus por superar o parceiro", () => {
    const seven = C("7", "ouros");
    const jack = C("J", "ouros");
    const v = view({
      dealerSeat: 3,
      handCards: [seven, jack],
      legalActions: playActions([seven, jack]),
      completedVazas: [completed(1)],
      currentVaza: {
        plays: [null, C("4", "copas"), C("Q", "copas"), C("6", "paus")],
        covered: [false, false, false, false],
        currentSeat: 0,
      },
    });
    const action = decidePlannedCardAction(
      v,
      playActions([seven, jack]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: seven });
  });
});

describe("planner: mão de onze usa partnerCards conhecidas", () => {
  const seven = C("7", "ouros");
  const queen = C("Q", "paus");
  const ace = C("A", "paus");
  const tableThree = C("3", "copas");
  const zap = C("5", "paus");
  const weakPartner = [C("4", "ouros"), C("6", "espadas"), C("7", "copas")];

  function elevenView(partnerCards: readonly Card[] | undefined): PlayerView {
    return view({
      isElevenHand: true,
      elevenDecision: "play",
      scores: [11, 5],
      partnerCards,
      handCards: [seven, queen],
      legalActions: playActions([seven, queen]),
      currentVaza: {
        plays: [null, null, null, tableThree],
        covered: [false, true, false, false],
        currentSeat: 0,
      },
    });
  }

  it("parceiro conhecido tem Zap: sabe que o parceiro cobre o 3", () => {
    const known = elevenView([zap, C("7", "espadas"), C("4", "copas")]);
    const unknown = elevenView(undefined);
    expect(probs(seven, known)).toEqual({ pWin: 1, pLose: 0, pTie: 0 });
    expect(probs(seven, unknown).pWin).toBeLessThan(1);
    expect(probs(seven, unknown).pWin).toBeGreaterThan(0);
  });

  it("parceiro conhecido só tem cartas fracas: não inventa cobertura", () => {
    const known = elevenView(weakPartner);
    const unknown = elevenView(undefined);
    expect(probs(seven, known)).toEqual({ pWin: 0, pLose: 1, pTie: 0 });
    expect(probs(seven, unknown).pWin).toBeGreaterThan(0);
  });

  it("não gasta Ás para cobrir um 3 se o parceiro já tem Zap", () => {
    const v = view({
      isElevenHand: true,
      elevenDecision: "play",
      scores: [11, 5],
      partnerCards: [zap, C("4", "copas"), C("6", "espadas")],
      handCards: [ace, seven],
      legalActions: playActions([ace, seven]),
      currentVaza: {
        plays: [null, null, null, tableThree],
        covered: [false, true, false, false],
        currentSeat: 0,
      },
    });
    const action = decidePlannedCardAction(
      v,
      playActions([ace, seven]),
      V3_FEATURES,
      midRng,
    );
    expect(action).toEqual({ type: "playCard", card: seven });
    expect(evaluateCardRoute(seven, v, V3_FEATURES)).toBeGreaterThan(
      evaluateCardRoute(ace, v, V3_FEATURES),
    );
  });
});
