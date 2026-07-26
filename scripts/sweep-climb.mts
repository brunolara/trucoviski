#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Hill climb de um candidato (roda no worker — sem IPC por eval)     */
/* ------------------------------------------------------------------ */

import type { HeuristicV2Features } from "../packages/bots/src/index.js";
import { evaluate } from "./sweep-eval.mts";
import type { CandidateResult } from "./sweep-eval.mts";

export type KnobKey =
  | "responseBaseOffset"
  | "proposeBaseOffset"
  | "elevenPairFloor"
  | "positionBeatsBonus"
  | "positionInfoBonus"
  | "raiseGuardMaxLevel"
  | "distDangerWeight"
  | "distFinishWeight"
  | "runCostWeight"
  | "softTopAliveBonus"
  | "softWonFirstBonus";

export const KNOB_RANGES: Record<
  KnobKey,
  { min: number; max: number; step: number }
> = {
  responseBaseOffset: { min: -1, max: 5, step: 0.5 },
  proposeBaseOffset: { min: -2, max: 5, step: 0.5 },
  elevenPairFloor: { min: 6, max: 10, step: 1 },
  // F5.2: knobs assinados — arena escolhe o sinal
  positionBeatsBonus: { min: -0.15, max: 0.15, step: 0.03 },
  positionInfoBonus: { min: -0.15, max: 0.15, step: 0.03 },
  raiseGuardMaxLevel: { min: 6, max: 12, step: 3 },
  distDangerWeight: { min: 0.0, max: 0.2, step: 0.02 },
  distFinishWeight: { min: 0.0, max: 0.2, step: 0.02 },
  runCostWeight: { min: 0.0, max: 0.25, step: 0.025 },
  softTopAliveBonus: { min: 0.1, max: 0.45, step: 0.05 },
  softWonFirstBonus: { min: 0.1, max: 0.4, step: 0.05 },
};

export function clampRound(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  return Number((min + steps * step).toFixed(4));
}

/**
 * Margem mínima para aceitar vizinho no climb (E0 / plano-bot-v4-ev).
 * ~2×SE de winrate espelhada a ~10k seeds — evita promover ruído de seed.
 */
export const CLIMB_ACCEPT_MARGIN = 0.02;

function neighbor(
  base: HeuristicV2Features,
  key: KnobKey,
  dir: -1 | 1,
): HeuristicV2Features | null {
  const { min, max, step } = KNOB_RANGES[key];
  const next = clampRound((base[key] as number) + dir * step, min, max, step);
  if (next === base[key]) return null;
  return { ...base, [key]: next };
}

export interface ClimbChainResult {
  result: CandidateResult;
  evals: number;
  discarded: number;
}

/**
 * Um chain completo: caminhada coordenada-a-coordenada + meio-passo.
 * Determinístico: mesma ordem de knobs, mesmas seeds, evaluate síncrono.
 */
export function climbChain(
  start: CandidateResult,
  games: number,
  seed: number,
  vsV2Only = false,
): ClimbChainResult {
  let current = start;
  let evals = 0;
  let discarded = 0;
  const maxEvals = 40;
  const opts = { vsV2Only };

  for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
    if (evals >= maxEvals) break;
    const neighbours = [
      neighbor(current.features, key, -1),
      neighbor(current.features, key, 1),
    ].filter((f): f is HeuristicV2Features => f !== null);
    if (neighbours.length === 0) continue;
    const batch = neighbours.slice(0, maxEvals - evals);
    for (const f of batch) {
      evals++;
      const ev = evaluate(f, games, seed, opts);
      if (ev.discarded) discarded++;
      else if (ev.fitness > current.fitness + CLIMB_ACCEPT_MARGIN) current = ev;
    }
  }

  for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
    if (evals >= maxEvals) break;
    const { min, max, step } = KNOB_RANGES[key];
    if (step >= 1) continue;
    const halfNeighbours: HeuristicV2Features[] = [];
    for (const dir of [-1, 1] as const) {
      const half = clampRound(
        (current.features[key] as number) + dir * step * 0.5,
        min,
        max,
        step * 0.5,
      );
      if (half === current.features[key]) continue;
      halfNeighbours.push({ ...current.features, [key]: half });
    }
    if (halfNeighbours.length === 0) continue;
    const batch = halfNeighbours.slice(0, maxEvals - evals);
    for (const f of batch) {
      evals++;
      const ev = evaluate(f, games, seed, opts);
      if (ev.discarded) discarded++;
      else if (ev.fitness > current.fitness + CLIMB_ACCEPT_MARGIN) current = ev;
    }
  }

  return { result: current, evals, discarded };
}
