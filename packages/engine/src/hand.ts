/* ------------------------------------------------------------------ */
/*  Mão – funções auxiliares puras para lógica de mão (hand)           */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import { resolveVazaAmong } from "./ranking.js";
import type {
  Card,
  CompletedVaza,
  Rank,
  Seat,
  Suit,
  Team,
  VazaInProgress,
} from "./types.js";
import { TEAMS } from "./types.js";

const NO_COVER: readonly [boolean, boolean, boolean, boolean] = [
  false,
  false,
  false,
  false,
];

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
    covered: NO_COVER,
    currentSeat: starter,
  };
}

/** Adiciona uma jogada à vaza em progresso. Retorna nova vaza. `card` é `null` para jogada coberta. */
export function playInVaza(
  vaza: VazaInProgress,
  seat: Seat,
  card: Card | null,
  covered: boolean,
): VazaInProgress {
  const newPlays = [...vaza.plays] as [
    Card | null,
    Card | null,
    Card | null,
    Card | null,
  ];
  newPlays[seat] = card;
  const newCovered = [...vaza.covered] as [boolean, boolean, boolean, boolean];
  newCovered[seat] = covered;
  const nextSeat = ((seat + 1) % 4) as Seat;
  return { plays: newPlays, covered: newCovered, currentSeat: nextSeat };
}

/** Verifica se a vaza está completa (todo assento jogou, coberto ou não). */
export function isVazaComplete(vaza: VazaInProgress): boolean {
  return vaza.plays.every((p, i) => p !== null || vaza.covered[i]);
}

/** Resolve uma vaza completa, retorna CompletedVaza. Ignora slots cobertos; canga se todos cobertos. */
export function completeVaza(
  plays: readonly [Card | null, Card | null, Card | null, Card | null],
  covered: readonly [boolean, boolean, boolean, boolean],
  vira: Card,
  dealerSeat: Seat,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): CompletedVaza {
  const activeSeats = [0, 1, 2, 3].filter((i) => !covered[i]) as Seat[];

  if (activeSeats.length === 0) {
    return { plays, covered, winner: null, tiedSeats: [] };
  }

  const activePlays = activeSeats.map((s) => plays[s]!);
  const result = resolveVazaAmong(
    activeSeats,
    activePlays,
    vira,
    dealerSeat,
    rankOrder,
    suitOrder,
  );
  return { plays, covered, winner: result.winner, tiedSeats: result.tiedSeats };
}

/**
 * Quem abre a próxima vaza após uma vaza completada.
 * Se todas as cartas foram cobertas (canga sem empatados), o mão abre.
 */
export function nextVazaStarter(
  completed: CompletedVaza,
  dealerSeat: Seat,
): Seat {
  if (completed.winner !== null) return completed.winner;
  return completed.tiedSeats[0] ?? dealerSeat;
}

/**
 * Vencedor da mão dado o conjunto de vazas já completadas, ou null se ainda
 * não decidido (precisa da 3ª vaza). Regra: 2 vazas para o mesmo time resolve;
 * na 3ª vaza o time com mais vazas vence; canga tripla decide para o time do mão.
 */
export function resolveHandWinner(
  completedVazas: readonly CompletedVaza[],
  dealerSeat: Seat,
): Team | null {
  let t0 = 0;
  let t1 = 0;
  for (const v of completedVazas) {
    if (v.winner !== null) {
      if (TEAMS[v.winner] === 0) t0++;
      else t1++;
    }
  }

  const n = completedVazas.length;

  if (n >= 3) {
    if (t0 > t1) return 0;
    if (t1 > t0) return 1;
    return TEAMS[dealerSeat];
  }

  if (n === 2) {
    if (t0 >= 1 && t1 === 0) return 0;
    if (t1 >= 1 && t0 === 0) return 1;
    return null;
  }

  return null;
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
