/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Strength – força de carta/mão e contagem de cartas vivas            */
/* ------------------------------------------------------------------ */

import { RANKS, createDeck, TEAMS } from "@trucoviski/engine";
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

/** Quantas cartas mais fortes que `card` ainda podem estar em jogo (não vistas). */
export function strongerCardsRemaining(
  card: Card,
  vira: Card,
  seenCards: readonly Card[],
): number {
  const seenKeys = new Set(seenCards.map(cardKey));
  const myStrength = getCardStrength(card, vira);
  return createDeck().filter(
    (c) => !seenKeys.has(cardKey(c)) && getCardStrength(c, vira) > myStrength,
  ).length;
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
