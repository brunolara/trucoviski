#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  E5: Avaliação de candidato na Liga (desenho estatístico corrigido) */
/*  Fitness = média na liga, estilo como restrição dura               */
/* ------------------------------------------------------------------ */

import { runArena, createPRNG } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  DEFAULT_FEATURES,
  V3_FEATURES,
  type HeuristicV2Features,
} from "../packages/bots/src/index.js";

export interface CandidateResultE5 {
  features: HeuristicV2Features;
  fitness: number;
  meanLeagueWr: number;
  worstWr: number;
  wrVsV2: number;
  wrVsV1: number;
  wrVsAgg: number;
  wrVsCons: number;
  selfPlayBigRate: number;
  selfPlay12Rate: number;
  discarded: boolean;
  games: number;
}

function makeV3Policy(features: HeuristicV2Features, botSeed: number) {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, rng, features);
}

function makeV2Policy(botSeed: number) {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  return (view: PlayerView): Action | null =>
    decideHeuristicV2Action(view, rng, DEFAULT_FEATURES);
}

function makeV1Policy() {
  return decideHeuristicAction;
}

function makeAggressivePolicy(botSeed: number) {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  const aggFeatures: HeuristicV2Features = {
    ...V3_FEATURES,
    responseBaseOffset: 0,
    proposeBaseOffset: 0,
  };
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, rng, aggFeatures);
}

function makeConservativePolicy(botSeed: number) {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  const consFeatures: HeuristicV2Features = {
    ...V3_FEATURES,
    responseBaseOffset: 7,
    proposeBaseOffset: 7,
    opponentWeaknessBluff: false,
  };
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, rng, consFeatures);
}

function closingBigRates(closingHandValues: Record<number, number>): {
  bigRate: number;
  rate12: number;
} {
  const entries = Object.entries(closingHandValues);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total === 0) return { bigRate: 0, rate12: 0 };
  const big = entries
    .filter(([k]) => Number(k) >= 9)
    .reduce((a, [, v]) => a + v, 0);
  const r12 = closingHandValues[12] ?? 0;
  return { bigRate: big / total, rate12: r12 / total };
}

export function evaluateE5(
  features: HeuristicV2Features,
  games: number,
  seed: number,
): CandidateResultE5 {
  const vsV2 = runArena({
    games,
    seed,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 11),
    policyTeam1: makeV2Policy(seed + 12),
  });

  const vsV1 = runArena({
    games,
    seed: seed + 10_000,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 21),
    policyTeam1: makeV1Policy(),
  });

  const vsAgg = runArena({
    games,
    seed: seed + 20_000,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 31),
    policyTeam1: makeAggressivePolicy(seed + 32),
  });

  const vsCons = runArena({
    games,
    seed: seed + 30_000,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 41),
    policyTeam1: makeConservativePolicy(seed + 42),
  });

  const selfGames = Math.max(400, Math.floor(games / 2));
  const selfPlay = runArena({
    games: selfGames,
    seed: seed + 40_000,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 51),
    policyTeam1: makeV3Policy(features, seed + 52),
  });

  const { bigRate: selfPlayBigRate, rate12: selfPlay12Rate } = closingBigRates(
    selfPlay.diagnostics.closingHandValues,
  );

  const wrVsV2 = vsV2.winRateTeam0;
  const wrVsV1 = vsV1.winRateTeam0;
  const wrVsAgg = vsAgg.winRateTeam0;
  const wrVsCons = vsCons.winRateTeam0;

  const meanLeagueWr = (wrVsV2 + wrVsV1 + wrVsAgg + wrVsCons) / 4;
  const worstWr = Math.min(wrVsV2, wrVsV1, wrVsAgg, wrVsCons);

  // Guardrail 1: restrição dura de estilo (mãos fechando em >=9 < 32%)
  // Guardrail 2: não regredir vs V1 nem vs V2
  const tol = games >= 10_000 ? 0.01 : 0.025;
  const discarded =
    selfPlayBigRate >= 0.33 ||
    wrVsV1 < 0.54 - tol ||
    wrVsV2 < 0.54 - tol ||
    wrVsCons < 0.58 - tol;

  const fitness = discarded ? Number.NEGATIVE_INFINITY : meanLeagueWr;

  return {
    features,
    fitness,
    meanLeagueWr,
    worstWr,
    wrVsV2,
    wrVsV1,
    wrVsAgg,
    wrVsCons,
    selfPlayBigRate,
    selfPlay12Rate,
    discarded,
    games,
  };
}
