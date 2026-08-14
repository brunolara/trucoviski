/* ------------------------------------------------------------------ */
/*  Políticas e blocos de seed partilhados por arena e liga            */
/* ------------------------------------------------------------------ */

import { createPRNG } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  decideMonteCarloAction,
  DEFAULT_FEATURES,
  V3_FEATURES,
} from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

/**
 * Blocos de seed. `test` foi contaminado (calibrado na F3–F5) e passou a ser
 * mais um bloco de treino. `holdout` abriu uma vez no fim da E5. `holdout-2`
 * é o holdout cego pós-correção do planner; não reabrir `holdout`.
 */
export const SEED_BLOCKS = {
  train: 42,
  test: 1_000_003,
  "train-a": 2_000_003,
  "train-b": 3_000_003,
  holdout: 9_000_007,
  "holdout-2": 11_000_013,
} as const;

export type SeedBlock = keyof typeof SEED_BLOCKS;
export const HOLDOUT_BLOCK: SeedBlock = "holdout";
export const HOLDOUT_BLOCKS: readonly SeedBlock[] = ["holdout", "holdout-2"];

export const AGGRESSIVE_FEATURES: HeuristicV2Features = {
  ...V3_FEATURES,
  responseBaseOffset: 0,
  proposeBaseOffset: 0,
};

export const CONSERVATIVE_FEATURES: HeuristicV2Features = {
  ...V3_FEATURES,
  responseBaseOffset: 7,
  proposeBaseOffset: 7,
  opponentWeaknessBluff: false,
};

export type PolicyName =
  | "random"
  | "heuristic-v1"
  | "heuristic-v2"
  | "heuristic-v3"
  | "agressivo"
  | "conservador"
  | "montecarlo";

export const LEAGUE_POLICIES: readonly PolicyName[] = [
  "heuristic-v1",
  "heuristic-v2",
  "heuristic-v3",
  "agressivo",
  "conservador",
];

export function makePolicy(
  name: PolicyName,
  botSeed: number,
  features?: HeuristicV2Features,
): (view: PlayerView) => Action | null {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  switch (name) {
    case "random":
      return () => null;
    case "heuristic-v1":
      return decideHeuristicAction;
    case "heuristic-v2":
      return (view) =>
        decideHeuristicV2Action(view, rng, features ?? DEFAULT_FEATURES);
    case "heuristic-v3":
      return (view) =>
        decideHeuristicV3Action(view, rng, features ?? V3_FEATURES);
    case "agressivo":
      return (view) =>
        decideHeuristicV3Action(view, rng, features ?? AGGRESSIVE_FEATURES);
    case "conservador":
      return (view) =>
        decideHeuristicV3Action(view, rng, features ?? CONSERVATIVE_FEATURES);
    case "montecarlo":
      return (view) => decideMonteCarloAction(view, { rng });
  }
}

export function assertSeedBlockAllowed(
  block: SeedBlock,
  unlockHoldout: boolean,
): void {
  if (HOLDOUT_BLOCKS.includes(block) && !unlockHoldout) {
    throw new Error(
      "Bloco holdout bloqueado. Passe --unlock-holdout se for mesmo isso.",
    );
  }
}
