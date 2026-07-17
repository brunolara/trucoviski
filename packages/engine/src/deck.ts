/* ------------------------------------------------------------------ */
/*  Baralho – criação e embaralhamento determinístico                  */
/* ------------------------------------------------------------------ */

import type { PRNG } from "./prng.js";
import type { Card, Rank, Suit } from "./types.js";

/** Todos os ranks do baralho francês de 40 cartas. */
export const DECK_RANKS: readonly Rank[] = [
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

/** Todos os naipes. */
export const DECK_SUITS: readonly Suit[] = [
  "paus",
  "copas",
  "espadas",
  "ouros",
];

/** Número total de cartas (40). */
export const DECK_SIZE = 40;

/** Cria o baralho completo em ordem canónica (não embaralhado). */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of DECK_SUITS) {
    for (const rank of DECK_RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** Cria e embaralha o baralho usando o PRNG fornecido. */
export function createShuffledDeck(rng: PRNG): Card[] {
  const deck = createDeck();
  rng.shuffle(deck);
  return deck;
}
