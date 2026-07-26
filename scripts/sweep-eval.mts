#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Avaliação de candidato do sweep v3 (compartilhado com o worker)    */
/* ------------------------------------------------------------------ */

import { createPRNG, runArena } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  DEFAULT_FEATURES,
} from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

/** v2 vs v1, arena espelhada, TEST_SEED+10k, N=40k. Reproduzir se algo mudar. */
const V2_VS_V1_BASELINE = 0.5474;

export interface CandidateResult {
  features: HeuristicV2Features;
  fitness: number;
  wrVsV2: number;
  wrVsV1: number;
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

export function evaluate(
  features: HeuristicV2Features,
  games: number,
  seed: number,
): CandidateResult {
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

  // F5.5: self-play — produção é todos os assentos na mesma política
  const selfGames = Math.max(500, Math.floor(games / 4));
  const selfPlay = runArena({
    games: selfGames,
    seed: seed + 20_000,
    mirrored: true,
    policyTeam0: makeV3Policy(features, seed + 31),
    policyTeam1: makeV3Policy(features, seed + 32),
  });
  const { bigRate: selfPlayBigRate, rate12: selfPlay12Rate } = closingBigRates(
    selfPlay.diagnostics.closingHandValues,
  );

  // F5.4: restrição dura — não regredir vs v1 em relação ao baseline do v2
  const tol = games >= 20_000 ? 0.005 : 0.02;
  if (vsV1.winRateTeam0 < V2_VS_V1_BASELINE - tol) {
    return {
      features,
      fitness: Number.NEGATIVE_INFINITY,
      wrVsV2: vsV2.winRateTeam0,
      wrVsV1: vsV1.winRateTeam0,
      selfPlayBigRate,
      selfPlay12Rate,
      discarded: true,
      games,
    };
  }

  // Penalidade = metade do objetivo (self-play ≥9), não desempate
  const penalty = selfPlayBigRate * 0.15;
  const fitness = vsV2.winRateTeam0 - penalty;
  return {
    features,
    fitness,
    wrVsV2: vsV2.winRateTeam0,
    wrVsV1: vsV1.winRateTeam0,
    selfPlayBigRate,
    selfPlay12Rate,
    discarded: false,
    games,
  };
}

export { V2_VS_V1_BASELINE };
