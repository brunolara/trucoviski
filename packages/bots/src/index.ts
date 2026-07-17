/* ------------------------------------------------------------------ */
/*  Bots – políticas de ação para IA do servidor (F4)                  */
/* ------------------------------------------------------------------ */

import type { PlayerView, Action } from "@trucoviski/engine";
import { decideHeuristicAction } from "./heuristic.js";

/**
 * Política determinística de bot: usa o bot heurístico inteligente.
 *
 * Só recebe PlayerView, nunca MatchState.
 */
export function decideBotAction(view: PlayerView): Action | null {
  return decideHeuristicAction(view);
}
export { decideHeuristicAction };
