/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Heuristic Bot v2 – contagem de cartas, estratégia de vaza correta,  */
/*  truco sensível a placar e blefe (F1+F2)                             */
/*                                                                      */
/*  ponytail: os pesos/flags abaixo (F) foram calibrados por varredura  */
/*  na arena (scripts/arena.mts) contra o bot v1 — não são "óbvios" na  */
/*  leitura, então ficam nomeados para eu (ou você) reabrir a varredura */
/*  se um dia o bot v1 for removido/mudado e a calibração precisar de   */
/*  reset.                                                              */
/* ------------------------------------------------------------------ */

import {
  RANKS,
  SUITS,
  compareCards,
  paulista,
  TEAMS,
} from "@trucoviski/engine";
import type { Card, PlayerView, Action } from "@trucoviski/engine";
import {
  getCardStrength,
  collectSeenCards,
  strongerCardsRemaining,
  myTeam,
  wonFirstVaza,
  partnerSeatOf,
} from "./strength.js";

/** Gerador de números aleatórios injetável (default: Math.random). Permite
 * determinismo em testes/arena e blefe real em produção. */
export type Rng = () => number;

export interface HeuristicV2Features {
  /** Aceitar sempre que carrego a carta mais forte ainda viva. */
  topAliveAccept: boolean;
  /** Como a vitória da 1ª vaza afeta o limiar de aceitar/pedir truco. */
  wonFirstVazaMode: "none" | "discount" | "override";
  /** Ajustar limiares de truco pelo placar (perdendo/ponto de match). */
  scoreSensitive: boolean;
  /** Blefe: mão fraca + adversário fraco na 1ª vaza → propor truco mesmo assim. */
  opponentWeaknessBluff: boolean;
  /** Descartar sempre a mais fraca quando o parceiro já vence a vaza, mesmo não sendo o último a jogar. */
  generalizedPartnerDiscard: boolean;
  /** Preferir cangar (empatar) a 2ª vaza a vencê-la quando já ganhamos a 1ª. */
  cangaOnPurpose: boolean;
  /** Sharpness da sigmoide de blefe (mais alto = mais determinístico). */
  sharpness: number;
}

export const DEFAULT_FEATURES: HeuristicV2Features = {
  topAliveAccept: true,
  wonFirstVazaMode: "override",
  scoreSensitive: true,
  opponentWeaknessBluff: true,
  generalizedPartnerDiscard: true,
  cangaOnPurpose: true,
  sharpness: 24,
};

function scoreToProbability(
  score: number,
  threshold: number,
  sharpness: number,
): number {
  const p = 1 / (1 + Math.exp(-sharpness * (score - threshold)));
  return Math.min(0.95, Math.max(0.05, p));
}

function myMaxStrength(cards: readonly Card[], vira: Card): number {
  return cards.length > 0
    ? Math.max(...cards.map((c) => getCardStrength(c, vira)))
    : 0;
}

/** Já carrego, na mão, a carta mais forte que ainda pode estar em jogo? */
function holdsTopAliveCard(view: PlayerView): boolean {
  if (view.handCards.length === 0) return false;
  const best = view.handCards.reduce((a, b) =>
    getCardStrength(a, view.vira) > getCardStrength(b, view.vira) ? a : b,
  );
  const seen = collectSeenCards(view);
  return strongerCardsRemaining(best, view.vira, seen) === 0;
}

/** Threshold de aceitar/pedir truco, ajustado pelo placar. */
function trucoThreshold(
  view: PlayerView,
  atRiskValue: number,
  base: number,
  scoreSensitive: boolean,
): number {
  if (!scoreSensitive) return base;
  const team = myTeam(view);
  const oppTeam = team === 0 ? 1 : 0;
  const myScore = view.scores[team];
  const oppScore = view.scores[oppTeam];

  let threshold = base;
  if (myScore < oppScore) threshold -= 0.08;
  if (oppScore + atRiskValue >= 12) threshold += 0.12;
  if (myScore + atRiskValue >= 12) threshold -= 0.12;
  return Math.min(0.92, Math.max(0.15, threshold));
}

function opponentWeaknessBonus(view: PlayerView): number {
  const first = view.completedVazas[0];
  if (!first) return 0;
  const team = myTeam(view);
  const oppStrengths = ([0, 1, 2, 3] as const)
    .filter((seat) => TEAMS[seat] !== team)
    .map((seat) => first.plays[seat])
    .filter((c): c is Card => c !== null)
    .map((c) => getCardStrength(c, view.vira));
  if (oppStrengths.length === 0) return 0;
  return Math.min(...oppStrengths) <= 2 ? 0.15 : 0;
}

function nextTrucoLevel(current: number): number {
  const seq = paulista.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx === -1 || idx === seq.length - 1) return current;
  return seq[idx + 1]!;
}

function pickWeakest<T extends { card: Card }>(
  actions: readonly T[],
  vira: Card,
): T {
  return actions.reduce((best, a) =>
    getCardStrength(a.card, vira) < getCardStrength(best.card, vira) ? a : best,
  );
}

export function decideHeuristicV2Action(
  view: PlayerView,
  rng: Rng = Math.random,
  features: HeuristicV2Features = DEFAULT_FEATURES,
): Action | null {
  const actions = view.legalActions;
  if (actions.length === 0) return null;

  // 1. Mão de onze
  const elevenActions = actions.filter((a) => a.type === "elevenDecision");
  if (elevenActions.length > 0) {
    const allCards = [...view.handCards, ...(view.partnerCards ?? [])];
    const myMax = myMaxStrength(view.handCards, view.vira);
    const partnerMax = myMaxStrength(view.partnerCards ?? [], view.vira);
    const teamMax = Math.max(myMax, partnerMax);
    const goodCount = allCards.filter(
      (c) => getCardStrength(c, view.vira) >= 8,
    ).length;

    let decision: "play" | "run";
    if (teamMax >= 11 || goodCount >= 3 || (myMax >= 9 && partnerMax >= 8)) {
      decision = "play";
    } else {
      const prob = scoreToProbability(
        teamMax / 13,
        8.5 / 13,
        features.sharpness,
      );
      decision = rng() < prob ? "play" : "run";
    }
    const selected = elevenActions.find(
      (a) => (a as { decision: string }).decision === decision,
    );
    if (selected) return selected;
  }

  // 2. Responder truco (aceitar/correr/aumentar)
  const trucoResponses = actions.filter(
    (a) =>
      a.type === "truco" &&
      ((a as { action: string }).action === "accept" ||
        (a as { action: string }).action === "run"),
  );
  if (trucoResponses.length > 0) {
    const atRisk = view.trucoPendingValue ?? view.trucoValue;
    const myMax = myMaxStrength(view.handCards, view.vira);
    const canRaise = actions.some(
      (a) => a.type === "truco" && (a as { action: string }).action === "raise",
    );

    if (myMax >= 12 && canRaise) {
      const raiseAction = actions.find(
        (a) =>
          a.type === "truco" && (a as { action: string }).action === "raise",
      );
      if (raiseAction) return raiseAction;
    }

    const wonFirst = wonFirstVaza(view);
    if (
      (features.topAliveAccept && holdsTopAliveCard(view)) ||
      (features.wonFirstVazaMode === "override" && wonFirst)
    ) {
      return (
        trucoResponses.find(
          (a) => (a as { action: string }).action === "accept",
        ) ?? null
      );
    }

    const discount =
      features.wonFirstVazaMode === "discount" && wonFirst ? 2.5 / 13 : 0;
    const base =
      (view.completedVazas.length === 0 ? 6.5 / 13 : 7.5 / 13) - discount;
    const threshold = trucoThreshold(
      view,
      atRisk,
      base,
      features.scoreSensitive,
    );
    const prob = scoreToProbability(myMax / 13, threshold, features.sharpness);
    const decision = rng() < prob ? "accept" : "run";
    const selected = trucoResponses.find(
      (a) => (a as { action: string }).action === decision,
    );
    return selected ?? null;
  }

  // 3. Propor truco
  const trucoProposals = actions.filter(
    (a) => a.type === "truco" && (a as { action: string }).action === "raise",
  );
  if (trucoProposals.length > 0) {
    const myMax = myMaxStrength(view.handCards, view.vira);
    const wonFirst = wonFirstVaza(view);
    const base = wonFirst ? 7.5 / 13 : 9.5 / 13;
    const threshold = trucoThreshold(
      view,
      nextTrucoLevel(view.trucoValue),
      base,
      features.scoreSensitive,
    );
    const score =
      myMax / 13 +
      (features.opponentWeaknessBluff ? opponentWeaknessBonus(view) : 0);
    if (rng() < scoreToProbability(score, threshold, features.sharpness)) {
      return trucoProposals[0] ?? null;
    }
  }

  // 4. Jogar carta
  const playCardActions = actions.filter((a) => a.type === "playCard") as {
    type: "playCard";
    card: Card;
  }[];
  if (playCardActions.length > 0) {
    const vazaIndex = view.completedVazas.length;
    const isOpening =
      !view.currentVaza || view.currentVaza.plays.every((p) => p === null);

    if (isOpening) {
      return pickWeakest(playCardActions, view.vira);
    }

    const plays = view.currentVaza!.plays;
    const partnerSeat = partnerSeatOf(view.mySeat);

    let bestCard: Card | null = null;
    let bestSeat: number | null = null;
    for (let i = 0; i < 4; i++) {
      const p = plays[i];
      if (
        p &&
        (!bestCard || compareCards(p, bestCard, view.vira, RANKS, SUITS) > 0)
      ) {
        bestCard = p;
        bestSeat = i;
      }
    }

    const partnerIsWinning = bestSeat === partnerSeat;
    const isLastToPlay = plays.filter((p) => p !== null).length === 3;
    if (
      partnerIsWinning &&
      (features.generalizedPartnerDiscard || isLastToPlay)
    ) {
      return pickWeakest(playCardActions, view.vira);
    }

    if (bestCard) {
      const winningActions = playCardActions.filter(
        (a) => compareCards(a.card, bestCard!, view.vira, RANKS, SUITS) > 0,
      );

      if (features.cangaOnPurpose && vazaIndex === 1 && wonFirstVaza(view)) {
        const tieActions = playCardActions.filter(
          (a) => compareCards(a.card, bestCard!, view.vira, RANKS, SUITS) === 0,
        );
        if (tieActions.length > 0) {
          return pickWeakest(tieActions, view.vira);
        }
      }

      if (winningActions.length > 0) {
        return pickWeakest(winningActions, view.vira);
      }
    }

    return pickWeakest(playCardActions, view.vira);
  }

  // 5. Ferro: playHiddenCard
  const playHiddenActions = actions.filter((a) => a.type === "playHiddenCard");
  if (playHiddenActions.length > 0) {
    return playHiddenActions[0] ?? null;
  }

  return actions.find((a) => a.type !== "surrender") ?? null;
}
