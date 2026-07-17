/* ------------------------------------------------------------------ */
/*  Mão – funções auxiliares puras para lógica de mão (hand)           */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import { resolveVaza } from "./ranking.js";
import type {
  Card,
  CompletedVaza,
  Rank,
  Seat,
  Suit,
  VazaInProgress,
} from "./types.js";

/** Distribui cartas aos 4 jogadores em ordem a partir do dealerSeat. */
export function dealCards(
  deck: readonly Card[],
  dealerSeat: Seat,
  cardsPerPlayer: number,
): readonly [Card[], Card[], Card[], Card[]] {
  const cpp = cardsPerPlayer;
  const result: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
  let idx = 0;
  for (let i = 0; i < 4; i++) {
    const seat = ((dealerSeat + i) % 4) as Seat;
    result[seat] = deck.slice(idx, idx + cpp);
    idx += cpp;
  }
  return result;
}

/** Índice da vira no baralho após distribuir cartas. */
export function viraIndex(cardsPerPlayer: number): number {
  return 4 * cardsPerPlayer;
}

/** Inicia uma nova vaza vazia. */
export function startVaza(starter: Seat): VazaInProgress {
  return {
    plays: [null, null, null, null],
    currentSeat: starter,
  };
}

/** Adiciona uma jogada à vaza em progresso. Retorna nova vaza. */
export function playInVaza(
  vaza: VazaInProgress,
  seat: Seat,
  card: Card,
): VazaInProgress {
  const newPlays = [...vaza.plays] as [
    Card | null,
    Card | null,
    Card | null,
    Card | null,
  ];
  newPlays[seat] = card;
  const nextSeat = ((seat + 1) % 4) as Seat;
  return { plays: newPlays, currentSeat: nextSeat };
}

/** Verifica se a vaza está completa. */
export function isVazaComplete(vaza: VazaInProgress): vaza is VazaInProgress & {
  plays: [Card, Card, Card, Card];
} {
  return vaza.plays.every((p) => p !== null);
}

/** Resolve uma vaza completa, retorna CompletedVaza. */
export function completeVaza(
  plays: readonly [Card, Card, Card, Card],
  vira: Card,
  dealerSeat: Seat,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): CompletedVaza {
  const result = resolveVaza(plays, vira, dealerSeat, rankOrder, suitOrder);
  return {
    plays,
    winner: result.winner,
    tiedSeats: result.tiedSeats,
  };
}

/** Quem abre a próxima vaza após uma vaza completada. */
export function nextVazaStarter(completed: CompletedVaza): Seat {
  if (completed.winner !== null) return completed.winner;
  return completed.tiedSeats[0]!;
}

/** Fase corrente da mão (para validação de ações). */
export function handPhase(hand: {
  isElevenHand: boolean;
  elevenDecision: "play" | "run" | null;
  finished: boolean;
}): "elevenDecision" | "playing" | "finished" {
  if (hand.isElevenHand && hand.elevenDecision === null) {
    return "elevenDecision";
  }
  if (hand.finished) {
    return "finished";
  }
  return "playing";
}
