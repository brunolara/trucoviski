/* ------------------------------------------------------------------ */
/*  Ranking – ordenação de cartas e resolução de vaza                  */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import type { Card, Rank, RuleSet, Seat, Suit } from "./types.js";

// ---- Rank seguinte (wrap) -------------------------------------------

/** Retorna o rank seguinte na ordem cíclica (usado para manilha). */
export function nextRank(rank: Rank, rankOrder: readonly Rank[]): Rank {
  const idx = rankOrder.indexOf(rank);
  if (idx === -1) throw new Error(`Unknown rank: ${rank}`);
  const next = (idx + 1) % rankOrder.length;
  return rankOrder[next]!;
}

// ---- Predicados de manilha ------------------------------------------

/** As 4 cartas que são manilhas para uma dada vira. */
export function manilhaCards(
  vira: Card,
  suitOrder: readonly Suit[],
  rankOrder: readonly Rank[],
): Card[] {
  const manilhaRank = nextRank(vira.rank, rankOrder);
  return suitOrder.map((suit): Card => ({ suit, rank: manilhaRank }));
}

/** Verifica se uma carta é manilha dada a vira. */
export function isManilha(
  card: Card,
  vira: Card,
  rankOrder: readonly Rank[],
): boolean {
  return card.rank === nextRank(vira.rank, rankOrder);
}

// ---- Comparação -----------------------------------------------------

function buildSuitStrength(suitOrder: readonly Suit[]): Record<Suit, number> {
  const rev = [...suitOrder].reverse();
  const map: Record<string, number> = {};
  for (let i = 0; i < rev.length; i++) {
    map[rev[i]!] = i;
  }
  return map as Record<Suit, number>;
}

function buildRankStrength(rankOrder: readonly Rank[]): Record<Rank, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < rankOrder.length; i++) {
    map[rankOrder[i]!] = i;
  }
  return map as Record<Rank, number>;
}

/**
 * Compara duas cartas no contexto de uma vira.
 * Retorna:
 *   > 0  se a é mais forte que b
 *   < 0  se b é mais forte que a
 *   = 0  empate (mesmo rank não-manilha)
 */
export function compareCards(
  a: Card,
  b: Card,
  vira: Card,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): number {
  const rankStrength = buildRankStrength(rankOrder);
  const suitStrength = buildSuitStrength(suitOrder);

  const aManilha = isManilha(a, vira, rankOrder);
  const bManilha = isManilha(b, vira, rankOrder);

  // Manilhas batem qualquer não-manilha
  if (aManilha && !bManilha) return 1;
  if (!aManilha && bManilha) return -1;

  // Ambas manilhas → compara por naipe
  if (aManilha && bManilha) {
    return suitStrength[a.suit] - suitStrength[b.suit];
  }

  // Nenhuma é manilha → compara por rank (empate cross-naipe)
  return rankStrength[a.rank] - rankStrength[b.rank];
}

/**
 * Determina o vencedor de uma vaza completa (4 cartas, uma por assento).
 * Retorna null em caso de empate (canga).
 *
 * A ordem de precedência para canga: o assento mais próximo do mão
 * (em ordem crescente a partir do dealerSeat, com wrap) entre os
 * empatados abre a próxima vaza.  Esta informação é retornada
 * no objeto de resultado.
 */
export interface VazaResult {
  /** null = canga (empate) */
  winner: Seat | null;
  /**
   * Assentos que empataram (ordenados pela proximidade ao mão).
   * Vazio se houver vencedor único.
   */
  tiedSeats: Seat[];
}

export function resolveVaza(
  plays: readonly [Card, Card, Card, Card],
  vira: Card,
  dealerSeat: Seat,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): VazaResult {
  // Encontra a carta mais alta
  let bestCard: Card = plays[0]!;
  let bestSeats: Seat[] = [0];

  for (let seat = 1; seat < 4; seat++) {
    const card = plays[seat]!;
    const cmp = compareCards(card, bestCard, vira, rankOrder, suitOrder);

    if (cmp > 0) {
      bestCard = card;
      bestSeats = [seat as Seat];
    } else if (cmp === 0) {
      // Manilhas nunca empatam (cada naipe é único)
      // Apenas não-manilhas de mesmo rank empatam
      bestSeats.push(seat as Seat);
    }
  }

  if (bestSeats.length === 1) {
    return { winner: bestSeats[0]!, tiedSeats: [] };
  }

  // Canga – ordena empatados pela proximidade ao mão (dealerSeat)
  const ordered = bestSeats.sort(
    (a, b) => seatDistance(a, dealerSeat) - seatDistance(b, dealerSeat),
  );

  return { winner: null, tiedSeats: ordered };
}

/** Distância circular de um assento ao dealer (mão). */
function seatDistance(seat: Seat, dealer: Seat): number {
  return (seat - dealer + 4) % 4;
}

// ---- Helpers de força (exportados para compatibilidade) --------------

export function suitOrder(ruleset: RuleSet): readonly Suit[] {
  return ruleset.suitOrder;
}

export function rankOrder(ruleset: RuleSet): readonly Rank[] {
  return ruleset.rankOrder;
}

// Re-export constants from RuleSet for backward compat in tests
// (exported through the paulista ruleset)
