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
 * Política de bot em produção: heurística v3. O v2 permanece exportado
 * como oponente de referência. Números atuais: docs/plano-bot-forca.md.
 * Monte Carlo não promovido (variância de EV no truco).
 *
 * Só recebe PlayerView, nunca MatchState (D-bot-1).
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
export { evaluateCardRoute, decidePlannedCardAction } from "./planning.js";
export type { MonteCarloOptions, RolloutPolicy } from "./montecarlo.js";
