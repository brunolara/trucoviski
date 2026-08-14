/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Planning – Planejamento curto de vazas (rota de vitória da mão)    */
/*  Avalia P(ganhar a mão) para cada carta candidata.                  */
/* ------------------------------------------------------------------ */

import { RANKS, SUITS, TEAMS, compareCards } from "@trucoviski/engine";
import type { Card, PlayerView, Seat } from "@trucoviski/engine";
import {
  collectSeenCards,
  getCardStrength,
  myTeam,
  partnerSeatOf,
  strongerCardsRemaining,
} from "./strength.js";
import type { HeuristicV2Features, Rng } from "./heuristic2.js";

type VazaOutcome = "won" | "lost" | "tied";

/**
 * Probabilidade de pelo menos um oponente possuir carta mais forte que a nossa,
 * dados `stronger` cartas mais fortes não vistas e `numCards` cartas na mão dos oponentes.
 */
export function probHasStronger(
  stronger: number,
  unseenTotal: number,
  numCards: number,
): number {
  if (stronger <= 0 || numCards <= 0 || unseenTotal <= 0) return 0;
  const nonStronger = unseenTotal - stronger;
  if (nonStronger < numCards) return 1;
  let pNone = 1;
  for (let i = 0; i < numCards; i++) {
    pNone *= (nonStronger - i) / (unseenTotal - i);
  }
  return Math.max(0, Math.min(1, 1 - pNone));
}

function probFutureCardWin(
  card: Card,
  fVazaIndex: number,
  vira: Card,
  seen: readonly Card[],
  unseenTotal: number,
): number {
  const cardsInFuture = Math.max(1, 3 - fVazaIndex);
  const stronger = strongerCardsRemaining(card, vira, seen);
  const pOppBeats = probHasStronger(stronger, unseenTotal, 2 * cardsInFuture);
  const myStrength = getCardStrength(card, vira);
  const neededStrength = Math.max(myStrength, 8);
  const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
  const partnerStronger = strongerCardsRemaining(
    { rank: partnerThreatRank, suit: "ouros" },
    vira,
    seen,
  );
  const pPartnerHelps =
    probHasStronger(partnerStronger, unseenTotal, cardsInFuture) * 0.35;
  return Math.max(0, Math.min(1, 1 - pOppBeats + pOppBeats * pPartnerHelps));
}

function resolveVazaOutcomeProbabilities(
  candidateCard: Card,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
): { pWin: number; pLose: number; pTie: number } {
  const mySeat = view.mySeat;
  const team = myTeam(view);
  const vazaIndex = view.completedVazas.length;
  const cardsPerPlayer = Math.max(1, 3 - vazaIndex);
  const plays = view.currentVaza?.plays ?? [null, null, null, null];

  let bestCard: Card | null = null;
  let bestSeat: Seat | null = null;

  for (let s = 0; s < 4; s++) {
    const p = plays[s];
    if (p) {
      if (!bestCard || compareCards(p, bestCard, view.vira, RANKS, SUITS) > 0) {
        bestCard = p;
        bestSeat = s as Seat;
      }
    }
  }

  let tableBest: Card;
  let tableBestSeat: Seat | null;

  if (!bestCard) {
    tableBest = candidateCard;
    tableBestSeat = mySeat;
  } else {
    const cmp = compareCards(candidateCard, bestCard, view.vira, RANKS, SUITS);
    if (cmp > 0) {
      tableBest = candidateCard;
      tableBestSeat = mySeat;
    } else if (cmp < 0) {
      tableBest = bestCard;
      tableBestSeat = bestSeat;
    } else {
      if (bestSeat !== null && TEAMS[bestSeat] === team) {
        tableBest = candidateCard;
        tableBestSeat = mySeat;
      } else {
        tableBest = candidateCard;
        tableBestSeat = null; // empate com oponente
      }
    }
  }

  // Assentos que ainda jogam após mySeat nesta vaza
  const partnerSeat = partnerSeatOf(mySeat);
  const remainingSeats = [
    ((mySeat + 1) % 4) as Seat,
    ((mySeat + 2) % 4) as Seat,
    ((mySeat + 3) % 4) as Seat,
  ].filter((s) => plays[s] === null);

  const oppsAfter = remainingSeats.filter((s) => TEAMS[s] !== team);
  const partnerAfter = remainingSeats.some((s) => s === partnerSeat);

  // Caso 1: Último a jogar nesta vaza
  if (remainingSeats.length === 0) {
    if (tableBestSeat !== null && TEAMS[tableBestSeat] === team) {
      return { pWin: 1, pLose: 0, pTie: 0 };
    }
    if (tableBestSeat !== null && TEAMS[tableBestSeat] !== team) {
      return { pWin: 0, pLose: 1, pTie: 0 };
    }
    return { pWin: 0, pLose: 0, pTie: 1 };
  }

  // Caso 2: Nosso time está liderando a mesa
  if (tableBestSeat !== null && TEAMS[tableBestSeat] === team) {
    const numOppCards = oppsAfter.length * cardsPerPlayer;
    const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
    const pOppBeats = probHasStronger(stronger, unseenTotal, numOppCards);

    if (!partnerAfter) {
      return {
        pWin: 1 - pOppBeats,
        pLose: pOppBeats,
        pTie: 0,
      };
    }

    const myCardStrength = getCardStrength(tableBest, view.vira);
    const neededStrength = Math.max(myCardStrength, 8);
    const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
    const partnerStronger = strongerCardsRemaining(
      { rank: partnerThreatRank, suit: "ouros" },
      view.vira,
      seen,
    );
    const pPartnerSaves =
      probHasStronger(partnerStronger, unseenTotal, cardsPerPlayer) * 0.35;
    const pWin = Math.min(1, 1 - pOppBeats + pOppBeats * pPartnerSaves);
    return {
      pWin,
      pLose: 1 - pWin,
      pTie: 0,
    };
  }

  // Caso 3: Oponente está liderando a mesa
  if (tableBestSeat !== null && TEAMS[tableBestSeat] !== team) {
    if (!partnerAfter) {
      return { pWin: 0, pLose: 1, pTie: 0 };
    }
    const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
    const pPartnerBeats = probHasStronger(
      stronger,
      unseenTotal,
      cardsPerPlayer,
    );
    const pWin = pPartnerBeats * (oppsAfter.length > 0 ? 0.45 : 0.85);
    return {
      pWin,
      pLose: 1 - pWin,
      pTie: 0,
    };
  }

  // Caso 4: Mesa empatada com oponente
  const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
  const pOppBeats = probHasStronger(
    stronger,
    unseenTotal,
    oppsAfter.length * cardsPerPlayer,
  );
  if (!partnerAfter) {
    return {
      pWin: 0,
      pLose: pOppBeats,
      pTie: 1 - pOppBeats,
    };
  }

  const myCardStrength = getCardStrength(tableBest, view.vira);
  const neededStrength = Math.max(myCardStrength, 8);
  const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
  const partnerStronger = strongerCardsRemaining(
    { rank: partnerThreatRank, suit: "ouros" },
    view.vira,
    seen,
  );
  const pPartnerSaves =
    probHasStronger(partnerStronger, unseenTotal, cardsPerPlayer) * 0.35;
  const pLose = pOppBeats * (1 - pPartnerSaves);
  const pWin = pOppBeats * pPartnerSaves;
  const pTie = Math.max(0, 1 - pLose - pWin);

  return { pWin, pLose, pTie };
}

function handWinProbVaza3(
  pWinV3: number,
  pLoseV3: number,
  pTieV3: number,
  v1: VazaOutcome,
  _v2: VazaOutcome,
  isHandPlayerTeam: boolean,
): number {
  let ev = 0;
  // Vitória na 3ª vaza sempre garante a mão
  ev += pWinV3 * 1.0;
  // Derrota na 3ª vaza perde a mão
  ev += pLoseV3 * 0.0;
  // Empate na 3ª vaza: decide por quem venceu a 1ª vaza (ou canga tripla pelo mão)
  if (v1 === "won") {
    ev += pTieV3 * 1.0;
  } else if (v1 === "lost") {
    ev += pTieV3 * 0.0;
  } else {
    ev += pTieV3 * (isHandPlayerTeam ? 1.0 : 0.0);
  }
  return ev;
}

function evalFutureVaza2(
  cardV2: Card,
  cardV3: Card,
  v1: VazaOutcome,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
  isHandPlayerTeam: boolean,
): number {
  const seenAfterV2 = [...seen, cardV2];
  const unseenAfterV2 = Math.max(1, unseenTotal - 1);

  const p2Win = probFutureCardWin(cardV2, 1, view.vira, seen, unseenTotal);
  const p2Lose = 1 - p2Win;
  const p2Tie = 0.04;

  const p3Win = probFutureCardWin(
    cardV3,
    2,
    view.vira,
    seenAfterV2,
    unseenAfterV2,
  );
  const p3Lose = 1 - p3Win;
  const p3Tie = 0.04;

  let ev = 0;

  // Se vencer a 2ª vaza:
  if (v1 === "won" || v1 === "tied") {
    ev += p2Win * 1.0; // Mão ganha imediatamente
  } else {
    // v1 == lost: precisa vencer a 3ª vaza
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "lost",
      "won",
      isHandPlayerTeam,
    );
    ev += p2Win * evV3;
  }

  // Se perder a 2ª vaza:
  if (v1 === "lost" || v1 === "tied") {
    ev += p2Lose * 0.0; // Mão perdida imediatamente
  } else {
    // v1 == won: vai para a 3ª vaza (onde empate favorece nosso time)
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "won",
      "lost",
      isHandPlayerTeam,
    );
    ev += p2Lose * evV3;
  }

  // Se empatar a 2ª vaza:
  if (v1 === "won") {
    ev += p2Tie * 1.0;
  } else if (v1 === "lost") {
    ev += p2Tie * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "tied",
      "tied",
      isHandPlayerTeam,
    );
    ev += p2Tie * evV3;
  }

  return ev;
}

function handWinProbVaza2(
  pWinV2: number,
  pLoseV2: number,
  pTieV2: number,
  v1: VazaOutcome,
  remCard: Card,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
  isHandPlayerTeam: boolean,
): number {
  const p3Win = probFutureCardWin(remCard, 2, view.vira, seen, unseenTotal);
  const p3Lose = 1 - p3Win;
  const p3Tie = 0.04;

  let ev = 0;

  if (v1 === "won" || v1 === "tied") {
    ev += pWinV2 * 1.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "lost",
      "won",
      isHandPlayerTeam,
    );
    ev += pWinV2 * evV3;
  }

  if (v1 === "lost" || v1 === "tied") {
    ev += pLoseV2 * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "won",
      "lost",
      isHandPlayerTeam,
    );
    ev += pLoseV2 * evV3;
  }

  if (v1 === "won") {
    ev += pTieV2 * 1.0;
  } else if (v1 === "lost") {
    ev += pTieV2 * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3Win,
      p3Lose,
      p3Tie,
      "tied",
      "tied",
      isHandPlayerTeam,
    );
    ev += pTieV2 * evV3;
  }

  return ev;
}

function firstVazaOutcome(view: PlayerView): VazaOutcome {
  const first = view.completedVazas[0];
  if (!first) return "tied";
  if (first.winner === null) return "tied";
  return TEAMS[first.winner] === myTeam(view) ? "won" : "lost";
}

function secondVazaOutcome(view: PlayerView): VazaOutcome {
  const second = view.completedVazas[1];
  if (!second) return "tied";
  if (second.winner === null) return "tied";
  return TEAMS[second.winner] === myTeam(view) ? "won" : "lost";
}

/**
 * Avalia a probabilidade esperada de vitória da mão se o jogador jogar `candidateCard`.
 */
export function evaluateCardRoute(
  candidateCard: Card,
  view: PlayerView,
  features?: HeuristicV2Features,
): number {
  const seen = collectSeenCards(view);
  const seenWithCandidate = [...seen, candidateCard];
  const unseenTotal = Math.max(1, 40 - seen.length);
  const unseenAfterCandidate = Math.max(1, 40 - seenWithCandidate.length);
  const isHandPlayerTeam = TEAMS[view.dealerSeat] === myTeam(view);
  const vazaIndex = view.completedVazas.length;

  let bonus = 0;

  // Bônus canga na 2ª vaza após vencer a 1ª
  if (
    features?.cangaOnPurpose &&
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "won"
  ) {
    const plays = view.currentVaza?.plays ?? [null, null, null, null];
    let bestOppCard: Card | null = null;
    for (let s = 0; s < 4; s++) {
      if (TEAMS[s as Seat] !== myTeam(view) && plays[s]) {
        if (
          !bestOppCard ||
          compareCards(plays[s]!, bestOppCard, view.vira, RANKS, SUITS) > 0
        ) {
          bestOppCard = plays[s]!;
        }
      }
    }
    if (
      bestOppCard &&
      compareCards(candidateCard, bestOppCard, view.vira, RANKS, SUITS) === 0
    ) {
      bonus += 0.35;
    }
  }

  // Abertura com mão 100% fraca (< 8) favorece descarte da mais fraca
  if (
    vazaIndex === 0 &&
    (!view.currentVaza || view.currentVaza.plays.every((p) => p === null))
  ) {
    const maxStrength = Math.max(
      ...view.handCards.map((c) => getCardStrength(c, view.vira)),
    );
    if (maxStrength < 8) {
      const minStrength = Math.min(
        ...view.handCards.map((c) => getCardStrength(c, view.vira)),
      );
      if (getCardStrength(candidateCard, view.vira) === minStrength) {
        bonus += 0.05;
      }
    }
  }

  // Abertura na 2ª vaza após perder a 1ª: abre com a mais forte
  if (
    features?.openingProfile &&
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "lost" &&
    (!view.currentVaza || view.currentVaza.plays.every((p) => p === null))
  ) {
    const maxStrength = Math.max(
      ...view.handCards.map((c) => getCardStrength(c, view.vira)),
    );
    if (getCardStrength(candidateCard, view.vira) === maxStrength) {
      bonus += 0.15;
    }
  }

  // Na 2ª vaza após perder a 1ª: superar a carta do oponente na mesa é imperativo
  const plays = view.currentVaza?.plays ?? [null, null, null, null];
  let bestTableCard: Card | null = null;
  for (let s = 0; s < 4; s++) {
    if (plays[s]) {
      if (
        !bestTableCard ||
        compareCards(plays[s]!, bestTableCard, view.vira, RANKS, SUITS) > 0
      ) {
        bestTableCard = plays[s]!;
      }
    }
  }

  if (
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "lost" &&
    bestTableCard &&
    compareCards(candidateCard, bestTableCard, view.vira, RANKS, SUITS) > 0
  ) {
    bonus += 0.2;
  }

  // Na 3ª vaza: se a carta vence a mesa, prioriza vencer com a mínima suficiente
  if (
    vazaIndex === 2 &&
    bestTableCard &&
    compareCards(candidateCard, bestTableCard, view.vira, RANKS, SUITS) > 0
  ) {
    bonus += 0.5;
  }

  const { pWin, pLose, pTie } = resolveVazaOutcomeProbabilities(
    candidateCard,
    view,
    seenWithCandidate,
    unseenTotal,
  );

  const remaining = view.handCards.filter(
    (c) => !(c.rank === candidateCard.rank && c.suit === candidateCard.suit),
  );

  if (vazaIndex === 2) {
    const v1 = firstVazaOutcome(view);
    const v2 = secondVazaOutcome(view);
    return (
      bonus + handWinProbVaza3(pWin, pLose, pTie, v1, v2, isHandPlayerTeam)
    );
  }

  if (vazaIndex === 1) {
    const v1 = firstVazaOutcome(view);
    const remCard =
      remaining.length > 0
        ? remaining.reduce((best, c) =>
            getCardStrength(c, view.vira) > getCardStrength(best, view.vira)
              ? c
              : best,
          )
        : candidateCard;

    return (
      bonus +
      handWinProbVaza2(
        pWin,
        pLose,
        pTie,
        v1,
        remCard,
        view,
        seenWithCandidate,
        unseenAfterCandidate,
        isHandPlayerTeam,
      )
    );
  }

  // vazaIndex === 0
  const r1 = remaining[0] ?? candidateCard;
  const r2 = remaining[1] ?? r1;

  const evIfWon = Math.max(
    evalFutureVaza2(
      r1,
      r2,
      "won",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
    evalFutureVaza2(
      r2,
      r1,
      "won",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
  );
  const evIfLost = Math.max(
    evalFutureVaza2(
      r1,
      r2,
      "lost",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
    evalFutureVaza2(
      r2,
      r1,
      "lost",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
  );
  const evIfTied = Math.max(
    evalFutureVaza2(
      r1,
      r2,
      "tied",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
    evalFutureVaza2(
      r2,
      r1,
      "tied",
      view,
      seenWithCandidate,
      unseenAfterCandidate,
      isHandPlayerTeam,
    ),
  );

  return bonus + pWin * evIfWon + pLose * evIfLost + pTie * evIfTied;
}

/**
 * Seleciona a melhor ação de jogar carta usando o planejamento curto de rotas.
 */
export function decidePlannedCardAction(
  view: PlayerView,
  playCardActions: readonly { type: "playCard"; card: Card }[],
  features: HeuristicV2Features,
  rng?: Rng,
): { type: "playCard"; card: Card } | null {
  if (playCardActions.length === 0) return null;
  if (playCardActions.length === 1) return playCardActions[0]!;

  let bestEV = -1;
  const scored: Array<{
    action: { type: "playCard"; card: Card };
    ev: number;
    strength: number;
  }> = [];

  for (const action of playCardActions) {
    const ev = evaluateCardRoute(action.card, view, features);
    const strength = getCardStrength(action.card, view.vira);
    scored.push({ action, ev, strength });
    if (ev > bestEV) bestEV = ev;
  }

  // Candidatos com EV próximo ao máximo (tolerância na 3ª vaza para mínima suficiente)
  const tolerance = view.completedVazas.length === 2 ? 0.6 : 0.005;
  const topCandidates = scored.filter((s) => s.ev >= bestEV - tolerance);
  if (topCandidates.length === 0) {
    return playCardActions[0] ?? null;
  }
  if (topCandidates.length === 1) {
    return topCandidates[0]!.action;
  }

  // Entre candidatos com EV equivalente, prefere economizar força (carta mais fraca)
  const minStrength = Math.min(...topCandidates.map((c) => c.strength));
  const tied = topCandidates.filter((c) => c.strength === minStrength);

  if (tied.length === 0) {
    return topCandidates[0]?.action ?? playCardActions[0] ?? null;
  }
  if (tied.length === 1 || !rng) {
    return tied[0]!.action;
  }

  const r = rng();
  const rawIdx =
    typeof r === "number" && !Number.isNaN(r) ? Math.floor(r * tied.length) : 0;
  const idx = Math.max(0, Math.min(tied.length - 1, rawIdx));
  return (tied[idx] ?? tied[0])!.action;
}
