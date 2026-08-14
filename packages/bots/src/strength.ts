/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Strength – força de carta/mão e contagem de cartas vivas            */
/* ------------------------------------------------------------------ */

import { RANKS, SUITS, createDeck, TEAMS } from "@trucoviski/engine";
import type { Card, PlayerView, Seat, Team } from "@trucoviski/engine";

/** Força de uma carta (0-9 cartas normais, 10-13 manilhas por naipe). */
export function getCardStrength(card: Card, vira: Card): number {
  const viraIdx = RANKS.indexOf(vira.rank);
  if (viraIdx === -1) return 0;
  const manilhaRank = RANKS[(viraIdx + 1) % RANKS.length]!;
  if (card.rank === manilhaRank) {
    if (card.suit === "ouros") return 10;
    if (card.suit === "espadas") return 11;
    if (card.suit === "copas") return 12;
    if (card.suit === "paus") return 13;
  }
  return RANKS.indexOf(card.rank);
}

/** Chave única de carta para uso em Set/Map. */
export function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

/**
 * Força normalizada (0..1) de um conjunto de cartas: pesa a carta mais forte
 * mais que as demais (é ela que decide a maioria das vazas/trucos — uma mão
 * com uma carta ótima e duas fracas ainda é uma mão boa), mais um bônus por
 * manilha (cada manilha praticamente garante uma vaza).
 */
export function handStrength(cards: readonly Card[], vira: Card): number {
  if (cards.length === 0) return 0;
  const strengths = [...cards.map((c) => getCardStrength(c, vira))].sort(
    (a, b) => b - a,
  );
  const manilhas = strengths.filter((s) => s >= 10).length;
  const weights = [0.6, 0.3, 0.1];
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < strengths.length; i++) {
    const w = weights[i] ?? 0.1 / strengths.length;
    weighted += strengths[i]! * w;
    weightSum += w;
  }
  return Math.min(1, weighted / weightSum / 13 + manilhas * 0.15);
}

/** Todas as cartas já vistas por este jogador (vira, mão própria, parceiro se visível, jogadas reveladas). */
export function collectSeenCards(view: PlayerView): Card[] {
  const seen: Card[] = [view.vira, ...view.handCards];
  if (view.partnerCards) seen.push(...view.partnerCards);
  for (const v of view.completedVazas) {
    for (const c of v.plays) if (c) seen.push(c);
  }
  if (view.currentVaza) {
    for (const c of view.currentVaza.plays) if (c) seen.push(c);
  }
  return seen;
}

/** Id numérico único de carta (naipe*16 + rank). Máx 4*16+9 = 73. */
function cardId(card: Card): number {
  return SUITS.indexOf(card.suit) * 16 + RANKS.indexOf(card.rank);
}

/**
 * tabela[s] = quantas cartas do baralho completo são mais fortes que a força s.
 * Depende só do vira, então fica cacheada por id do vira — no máximo 40 tabelas
 * na vida do processo, e na prática 1 por mão.
 *
 * ponytail: cache global mutável, mas a função é pura em `vira` (mesma vira →
 * mesma tabela), então não há contaminação entre partidas ou entre threads.
 */
const STRONGER_TABLE: (Int8Array | undefined)[] = [];

function strongerTable(vira: Card): Int8Array {
  const key = cardId(vira);
  const cached = STRONGER_TABLE[key];
  if (cached) return cached;
  const table = new Int8Array(15); // forças 0..13, +1 de folga
  const deck = createDeck();
  for (let s = 0; s <= 14; s++) {
    let n = 0;
    for (const c of deck) if (getCardStrength(c, vira) > s) n++;
    table[s] = n;
  }
  STRONGER_TABLE[key] = table;
  return table;
}

/** Quantas cartas mais fortes que `card` ainda podem estar em jogo (não vistas). */
export function strongerCardsRemaining(
  card: Card,
  vira: Card,
  seenCards: readonly Card[],
): number {
  const myStrength = getCardStrength(card, vira);
  // Dedupe por id numérico: a versão antiga deduplicava via Set<string> e o
  // resultado precisa continuar idêntico mesmo se `seen` repetir uma carta.
  const counted = new Set<number>();
  let seenStronger = 0;
  for (const c of seenCards) {
    if (getCardStrength(c, vira) <= myStrength) continue;
    const id = cardId(c);
    if (counted.has(id)) continue;
    counted.add(id);
    seenStronger++;
  }
  return strongerTable(vira)[myStrength]! - seenStronger;
}

/**
 * Cartas de mesmo rank ainda não vistas. Manilhas desempatam por naipe, então
 * nunca empatam: devolve 0.
 */
export function equalCardsRemaining(
  card: Card,
  vira: Card,
  seenCards: readonly Card[],
): number {
  if (getCardStrength(card, vira) >= 10) return 0;
  const myId = cardId(card);
  const counted = new Set<number>();
  let seenEqual = 0;
  for (const c of seenCards) {
    if (c.rank !== card.rank) continue;
    const id = cardId(c);
    if (id === myId || counted.has(id)) continue;
    counted.add(id);
    seenEqual++;
  }
  return Math.max(0, 3 - seenEqual);
}

export function myTeam(view: PlayerView): Team {
  return TEAMS[view.mySeat];
}

/** Se o meu time venceu a primeira vaza já completada. */
export function wonFirstVaza(view: PlayerView): boolean {
  const first = view.completedVazas[0];
  if (!first || first.winner === null) return false;
  return TEAMS[first.winner] === myTeam(view);
}

export function partnerSeatOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}
