/* Features do modelo p (plano-bot-v4-ev E2). Ordem fixa — treino e inferência. */

import { paulista, TEAMS } from "@trucoviski/engine";
import type { PlayerView } from "@trucoviski/engine";
import { assessHand } from "./assessment.js";
import {
  collectSeenCards,
  getCardStrength,
  strongerCardsRemaining,
  myTeam,
  partnerSeatOf,
} from "./strength.js";

/** Nomes na mesma ordem de `extractTrucoFeatures`. */
export const P_FEATURE_NAMES = [
  "topTwo",
  "myMax",
  "holdsTopAlive",
  "beatsTable",
  "partnerIsWinning",
  "isLastToPlay",
  "cardsPlayedInVaza",
  "won1",
  "lost1",
  "tied1",
  "mustWinBoth",
  "vazaIndex",
  "cardsLeft",
  "strongerRemaining",
  "trucoLevel",
  "raiserMe",
  "raiserPartner",
  "raiserOpp",
  "raiseVaza",
  "oppRaiseCount",
  "oppRaiseAfterLostFirst",
  "isEleven",
] as const;

export type PFeatureName = (typeof P_FEATURE_NAMES)[number];

/**
 * Vetor de features para P(vencer a mão | visão).
 * Só faz sentido em turnos com truco no menu.
 */
export function extractTrucoFeatures(view: PlayerView): number[] {
  const a = assessHand(view);
  const team = myTeam(view);
  const partner = partnerSeatOf(view.mySeat);
  const seq = paulista.trucoSequence;
  const levelVal = view.trucoPendingValue ?? view.trucoValue;
  const trucoLevel = Math.max(0, seq.indexOf(levelVal)) / 4;

  const lastRaise = view.trucoRaises[view.trucoRaises.length - 1];
  let raiserMe = 0;
  let raiserPartner = 0;
  let raiserOpp = 0;
  let raiseVaza = 0;
  if (lastRaise) {
    raiseVaza = lastRaise.vazaIndex / 2;
    if (lastRaise.seat === view.mySeat) raiserMe = 1;
    else if (lastRaise.seat === partner) raiserPartner = 1;
    else raiserOpp = 1;
  }

  const oppTeam = team === 0 ? 1 : 0;
  const oppRaiseCount =
    view.trucoRaises.filter((r) => r.team === oppTeam).length / 4;

  let oppRaiseAfterLostFirst = 0;
  const first = view.completedVazas[0];
  if (first && first.winner !== null && TEAMS[first.winner] === team) {
    if (view.trucoRaises.some((r) => r.team === oppTeam && r.vazaIndex >= 1)) {
      oppRaiseAfterLostFirst = 1;
    }
  }

  const seen = collectSeenCards(view);
  let strongerRemaining = 0;
  if (view.handCards.length > 0) {
    const top = view.handCards.reduce((x, y) =>
      getCardStrength(y, view.vira) > getCardStrength(x, view.vira) ? y : x,
    );
    strongerRemaining = strongerCardsRemaining(top, view.vira, seen) / 39;
  }

  return [
    a.topTwo,
    a.myMax / 13,
    a.holdsTopAlive ? 1 : 0,
    a.beatsTable ? 1 : 0,
    a.partnerIsWinning ? 1 : 0,
    a.isLastToPlay ? 1 : 0,
    a.cardsPlayedInVaza / 3,
    a.vazaScore === "won1" ? 1 : 0,
    a.vazaScore === "lost1" ? 1 : 0,
    a.vazaScore === "tied1" ? 1 : 0,
    a.mustWinBoth ? 1 : 0,
    view.completedVazas.length / 2,
    view.handCards.length / 3,
    strongerRemaining,
    trucoLevel,
    raiserMe,
    raiserPartner,
    raiserOpp,
    raiseVaza,
    oppRaiseCount,
    oppRaiseAfterLostFirst,
    view.isElevenHand ? 1 : 0,
  ];
}

/** Features públicas + nível proposto — modelo q = P(adversário corre). */
export const Q_FEATURE_NAMES = [
  "proposedLevel",
  "currentTrucoLevel",
  "won1",
  "lost1",
  "tied1",
  "vazaIndex",
  "cardsPlayedInVaza",
  "partnerIsWinning",
  "beatsTable",
  "isLastToPlay",
  "mustWinBoth",
  "oppRaiseCount",
  "oppRaiseAfterLostFirst",
  "raiserMe",
  "raiserPartner",
  "raiserOpp",
  "raiseVaza",
  "isEleven",
  "scoreUs",
  "scoreThem",
  "distToWin",
  "distToLose",
] as const;

export type QFeatureName = (typeof Q_FEATURE_NAMES)[number];

/**
 * Vetor para P(adversário corre | eu aumento para proposedLevel).
 * Só features públicas + nível (visão que o adversário também vê).
 */
export function extractQFeatures(
  view: PlayerView,
  proposedLevel: number,
): number[] {
  const a = assessHand(view);
  const team = myTeam(view);
  const partner = partnerSeatOf(view.mySeat);
  const seq = paulista.trucoSequence;
  const currentLevel = Math.max(0, seq.indexOf(view.trucoValue)) / 4;
  const proposed = Math.max(0, seq.indexOf(proposedLevel)) / 4;

  const lastRaise = view.trucoRaises[view.trucoRaises.length - 1];
  let raiserMe = 0;
  let raiserPartner = 0;
  let raiserOpp = 0;
  let raiseVaza = 0;
  if (lastRaise) {
    raiseVaza = lastRaise.vazaIndex / 2;
    if (lastRaise.seat === view.mySeat) raiserMe = 1;
    else if (lastRaise.seat === partner) raiserPartner = 1;
    else raiserOpp = 1;
  }

  const oppTeam = team === 0 ? 1 : 0;
  const oppRaiseCount =
    view.trucoRaises.filter((r) => r.team === oppTeam).length / 4;

  let oppRaiseAfterLostFirst = 0;
  const first = view.completedVazas[0];
  if (first && first.winner !== null && TEAMS[first.winner] === team) {
    if (view.trucoRaises.some((r) => r.team === oppTeam && r.vazaIndex >= 1)) {
      oppRaiseAfterLostFirst = 1;
    }
  }

  const scoreUs = view.scores[team] / 12;
  const scoreThem = view.scores[oppTeam] / 12;

  return [
    proposed,
    currentLevel,
    a.vazaScore === "won1" ? 1 : 0,
    a.vazaScore === "lost1" ? 1 : 0,
    a.vazaScore === "tied1" ? 1 : 0,
    view.completedVazas.length / 2,
    a.cardsPlayedInVaza / 3,
    a.partnerIsWinning ? 1 : 0,
    a.beatsTable ? 1 : 0,
    a.isLastToPlay ? 1 : 0,
    a.mustWinBoth ? 1 : 0,
    oppRaiseCount,
    oppRaiseAfterLostFirst,
    raiserMe,
    raiserPartner,
    raiserOpp,
    raiseVaza,
    view.isElevenHand ? 1 : 0,
    scoreUs,
    scoreThem,
    (12 - view.scores[team]) / 12,
    (12 - view.scores[oppTeam]) / 12,
  ];
}
