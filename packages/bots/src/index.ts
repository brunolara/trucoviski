/* ------------------------------------------------------------------ */
/*  Bots – políticas de ação para IA do servidor (F4, evoluído em F0-F3) */
/* ------------------------------------------------------------------ */

import type { PlayerView, Action } from "@trucoviski/engine";
import { decideHeuristicAction } from "./heuristic.js";
import { decideHeuristicV2Action, DEFAULT_FEATURES } from "./heuristic2.js";
import { decideMonteCarloAction } from "./montecarlo.js";

/**
 * Política de bot em produção: heurística v2 (F1+F2), validada na arena com
 * ~54% de winrate em 24k jogos contra a v1 (scripts/arena.mts).
 *
 * O bot Monte Carlo (F3, decideMonteCarloAction) está implementado e bate o
 * bot aleatório com folga, mas a estimativa de EV para decisões de truco
 * ainda tem variância alta nas contagens de amostra viáveis em produção —
 * ponytail: não promovido a padrão até isso ser resolvido (mais amostras,
 * política de rollout menos ruidosa, ou modelar a cadeia de truco com mais
 * cuidado). Ver scripts/arena.mts para comparar.
 *
 * Só recebe PlayerView, nunca MatchState.
 */
export function decideBotAction(view: PlayerView): Action | null {
  return decideHeuristicV2Action(view);
}

export {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideMonteCarloAction,
  DEFAULT_FEATURES,
};
export type { Rng, HeuristicV2Features } from "./heuristic2.js";
export type { MonteCarloOptions, RolloutPolicy } from "./montecarlo.js";
