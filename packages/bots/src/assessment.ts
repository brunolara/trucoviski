/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* Avaliação de mão compartilhada (heuristic2 + features p). */

import { RANKS, SUITS, compareCards, TEAMS } from "@trucoviski/engine";
import type { Card, PlayerView } from "@trucoviski/engine";
import {
  getCardStrength,
  handStrength,
  collectSeenCards,
  strongerCardsRemaining,
  myTeam,
  partnerSeatOf,
} from "./strength.js";

export interface HandAssessment {
  myMax: number;
  /** handStrength() normalizado 0..1. */
  topTwo: number;
  holdsTopAlive: boolean;
  cardsPlayedInVaza: 0 | 1 | 2 | 3;
  isLastToPlay: boolean;
  beatsTable: boolean;
  partnerIsWinning: boolean;
  vazaScore: "won1" | "lost1" | "tied1" | "none";
  mustWinBoth: boolean;
  distToWin: number;
  distToLose: number;
  /** Melhor carta na mesa atual (null se vazia). */
  bestCardOnTable: Card | null;
  bestSeatOnTable: number | null;
}

function myMaxStrength(cards: readonly Card[], vira: Card): number {
  return cards.length > 0
    ? Math.max(...cards.map((c) => getCardStrength(c, vira)))
    : 0;
}

function holdsTopAliveCard(view: PlayerView): boolean {
  if (view.handCards.length === 0) return false;
  const best = view.handCards.reduce((a, b) =>
    getCardStrength(a, view.vira) > getCardStrength(b, view.vira) ? a : b,
  );
  const seen = collectSeenCards(view);
  return strongerCardsRemaining(best, view.vira, seen) === 0;
}

function firstVazaScore(view: PlayerView): HandAssessment["vazaScore"] {
  const first = view.completedVazas[0];
  if (!first) return "none";
  if (first.winner === null) return "tied1";
  return TEAMS[first.winner] === myTeam(view) ? "won1" : "lost1";
}

/** Fatos da mão calculados uma vez; decisões de truco e de carta consomem. */
export function assessHand(view: PlayerView): HandAssessment {
  const team = myTeam(view);
  const oppTeam = team === 0 ? 1 : 0;
  const myMax = myMaxStrength(view.handCards, view.vira);
  const topTwo = handStrength(view.handCards, view.vira);
  const holdsTopAlive = holdsTopAliveCard(view);
  const vazaScore = firstVazaScore(view);

  let bestCardOnTable: Card | null = null;
  let bestSeatOnTable: number | null = null;
  let cardsPlayedInVaza = 0 as 0 | 1 | 2 | 3;

  if (view.currentVaza) {
    const plays = view.currentVaza.plays;
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const p = plays[i];
      if (p) {
        count++;
        if (
          !bestCardOnTable ||
          compareCards(p, bestCardOnTable, view.vira, RANKS, SUITS) > 0
        ) {
          bestCardOnTable = p;
          bestSeatOnTable = i;
        }
      }
    }
    cardsPlayedInVaza = Math.min(3, count) as 0 | 1 | 2 | 3;
  }

  const partnerSeat = partnerSeatOf(view.mySeat);
  const partnerIsWinning = bestSeatOnTable === partnerSeat;
  const isLastToPlay = cardsPlayedInVaza === 3;
  const beatsTable =
    bestCardOnTable !== null &&
    view.handCards.some(
      (c) => compareCards(c, bestCardOnTable!, view.vira, RANKS, SUITS) > 0,
    );

  return {
    myMax,
    topTwo,
    holdsTopAlive,
    cardsPlayedInVaza,
    isLastToPlay,
    beatsTable,
    partnerIsWinning,
    vazaScore,
    mustWinBoth: vazaScore === "lost1",
    distToWin: 12 - view.scores[team],
    distToLose: 12 - view.scores[oppTeam],
    bestCardOnTable,
    bestSeatOnTable,
  };
}

export { myMaxStrength };
