/* ------------------------------------------------------------------ */
/*  RuleSet paulista – regras oficiais do Truco Paulista               */
/* ------------------------------------------------------------------ */

import type { Rank, RuleSet, Seat, Suit, Team } from "../types.js";
import { TEAMS } from "../types.js";

// ---- Constantes do baralho paulista ---------------------------------

const PAULISTA_RANK_ORDER: readonly Rank[] = [
  "4",
  "5",
  "6",
  "7",
  "Q",
  "J",
  "K",
  "A",
  "2",
  "3",
];

const PAULISTA_SUIT_ORDER: readonly Suit[] = [
  "paus",
  "copas",
  "espadas",
  "ouros",
];

/** Sequência de valores de truco: 1 (mão) → 3 (truco) → 6 → 9 → 12. */
const PAULISTA_TRUCO_SEQUENCE: readonly number[] = [1, 3, 6, 9, 12];

// ---- RuleSet concreto -----------------------------------------------

export const paulista = {
  name: "paulista",
  version: "1.0.0",

  rankOrder: PAULISTA_RANK_ORDER,
  suitOrder: PAULISTA_SUIT_ORDER,
  trucoSequence: PAULISTA_TRUCO_SEQUENCE,

  winThreshold: 12,
  elevenThreshold: 11,
  cardsPerPlayer: 3,

  /** Times fixos: assentos opostos são parceiros (0↔2, 1↔3). */
} satisfies RuleSet;

/** Helper: time de um assento. */
export function teamForSeat(seat: Seat): Team {
  return TEAMS[seat];
}
