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
 * Política de bot em produção: heurística v3 (F4), calibrada na arena
 * (~53% vs v2, ~54% vs v1 em 20k partidas espelhadas — ver
 * docs/plano-bot-v3.md). O v2 permanece exportado como oponente de
 * referência. Monte Carlo não promovido (variância de EV no truco).
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
export type { MonteCarloOptions, RolloutPolicy } from "./montecarlo.js";
