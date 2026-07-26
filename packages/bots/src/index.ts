/* ------------------------------------------------------------------ */
/*  Bots – políticas de ação para IA do servidor                       */
/* ------------------------------------------------------------------ */

import type { PlayerView, Action } from "@trucoviski/engine";
import { decideHeuristicAction } from "./heuristic.js";
import {
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  DEFAULT_FEATURES,
  V3_FEATURES,
} from "./heuristic2.js";
import { decideMonteCarloAction } from "./montecarlo.js";

/**
 * Política de bot em produção: heurística v3 (F6b), ~55,3% vs v2 em 30k
 * partidas espelhadas — ver docs/plano-bot-v3.md. O v2 permanece exportado
 * como oponente de referência.
 *
 * Só recebe PlayerView, nunca MatchState.
 */
export function decideBotAction(view: PlayerView): Action | null {
  return decideHeuristicV3Action(view);
}

export {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  decideMonteCarloAction,
  DEFAULT_FEATURES,
  V3_FEATURES,
};
export type { Rng, HeuristicV2Features, HandAssessment } from "./heuristic2.js";
export { assessHand, distanceCovers } from "./heuristic2.js";
export { W_TABLE, matchWinProb } from "./wtable.js";
export {
  extractTrucoFeatures,
  extractQFeatures,
  P_FEATURE_NAMES,
  Q_FEATURE_NAMES,
} from "./features.js";
export { winProbability, hasPModel, loadPModel } from "./pmodel.js";
export { foldProbability, hasQModel, loadQModel } from "./qmodel.js";
export {
  winProbabilityGivenCall,
  hasPPrimeModel,
  loadPPrimeModel,
} from "./pprime.js";
export type { MonteCarloOptions, RolloutPolicy } from "./montecarlo.js";
