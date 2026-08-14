/* ------------------------------------------------------------------ */
/*  Ranking – ordenação de cartas e resolução de vaza                  */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import type { Card, Rank, RuleSet, Seat, Suit, Team } from "./types.js";
import { TEAMS } from "./types.js";

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
  return resolveVazaAmong(
    [0, 1, 2, 3],
    plays,
    vira,
    dealerSeat,
    rankOrder,
    suitOrder,
  );
}

/**
 * Como `resolveVaza`, mas resolve apenas entre um subconjunto de assentos
 * (usado para vazas com cartas cobertas, que não competem).
 */
export function resolveVazaAmong(
  seats: readonly Seat[],
  cards: readonly Card[],
  vira: Card,
  dealerSeat: Seat,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): VazaResult {
  let bestCard: Card = cards[0]!;
  let bestSeats: Seat[] = [seats[0]!];

  for (let i = 1; i < seats.length; i++) {
    const card = cards[i]!;
    const cmp = compareCards(card, bestCard, vira, rankOrder, suitOrder);

    if (cmp > 0) {
      bestCard = card;
      bestSeats = [seats[i]!];
    } else if (cmp === 0) {
      // Manilhas nunca empatam (cada naipe é único)
      // Apenas não-manilhas de mesmo rank empatam
      bestSeats.push(seats[i]!);
    }
  }

  if (bestSeats.length === 1) {
    return { winner: bestSeats[0]!, tiedSeats: [] };
  }

  // Ordena empatados pela proximidade ao mão (dealerSeat)
  const ordered = bestSeats.sort(
    (a, b) => seatDistance(a, dealerSeat) - seatDistance(b, dealerSeat),
  );

  // Empate entre parceiros não é canga: o time leva a vaza.
  if (ordered.every((s) => TEAMS[s] === TEAMS[ordered[0]!])) {
    return { winner: ordered[0]!, tiedSeats: [] };
  }

  return { winner: null, tiedSeats: ordered };
}

/**
 * Quem lidera uma vaza ainda incompleta, usando a mesma regra de
 * `resolveVazaAmong` (empate cross-time é canga; empate entre parceiros
 * fica com o time). `candidate` cobre a jogada que o assento atual
 * ainda vai fazer. Assentos com `plays[s] === null` (incluindo cobertos)
 * não competem.
 */
export type PartialVazaLeader =
  | {
      readonly type: "team";
      readonly team: Team;
      readonly card: Card;
      readonly seat: Seat;
    }
  | { readonly type: "tie"; readonly card: Card };

export function partialVazaLeader(
  plays: readonly [Card | null, Card | null, Card | null, Card | null],
  candidate: { readonly seat: Seat; readonly card: Card } | null,
  vira: Card,
  dealerSeat: Seat,
  rankOrder: readonly Rank[],
  suitOrder: readonly Suit[],
): PartialVazaLeader | null {
  const seats: Seat[] = [];
  const cards: Card[] = [];
  for (let s = 0; s < 4; s++) {
    const seat = s as Seat;
    const card = candidate?.seat === seat ? candidate.card : plays[seat];
    if (card) {
      seats.push(seat);
      cards.push(card);
    }
  }
  if (seats.length === 0) return null;

  const result = resolveVazaAmong(
    seats,
    cards,
    vira,
    dealerSeat,
    rankOrder,
    suitOrder,
  );
  if (result.winner !== null) {
    const idx = seats.indexOf(result.winner);
    return {
      type: "team",
      team: TEAMS[result.winner],
      card: cards[idx]!,
      seat: result.winner,
    };
  }
  const tieSeat = result.tiedSeats[0]!;
  const idx = seats.indexOf(tieSeat);
  return { type: "tie", card: cards[idx] ?? cards[0]! };
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
