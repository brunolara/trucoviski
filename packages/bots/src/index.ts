/* ------------------------------------------------------------------ */
/*  Bots – políticas de ação para IA do servidor (F4, evoluído em F0-F3) */
/* ------------------------------------------------------------------ */

import type { PlayerView, Action } from "@trucoviski/engine";
import { decideHeuristicAction } from "./heuristic.js";
import { decideHeuristicV2Action } from "./heuristic2.js";
import { decideMonteCarloAction } from "./montecarlo.js";

/**
 * Política de bot em produção: Monte Carlo com determinização (F3), a mais
 * forte disponível. Cai para a heurística v2 se o MC não decidir nada
 * (não deveria acontecer com legalActions não-vazio, mas é o limite do sistema).
 *
 * Só recebe PlayerView, nunca MatchState.
 */
export function decideBotAction(view: PlayerView): Action | null {
  return decideMonteCarloAction(view) ?? decideHeuristicV2Action(view);
}

export {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideMonteCarloAction,
};
export type { Rng } from "./heuristic2.js";
export type { MonteCarloOptions, RolloutPolicy } from "./montecarlo.js";
