#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  E4: Experimento PIMC para cartas + Truco v3                        */
/*  Compara PIMC com 16, 32, 64 amostras vs Heuristic v3 (E3 vazaPlan) */
/*  Mede também latência por decisão (p50, p95, p99, mean)              */
/* ------------------------------------------------------------------ */

import { runArena, createPRNG } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicV3Action,
  decideMonteCarloAction,
  V3_FEATURES,
  type Rng,
  type HeuristicV2Features,
} from "../packages/bots/src/index.js";
import { SEED_BLOCKS, type SeedBlock } from "./bot-policies.mts";

export function makePimcCardsV3Truco(
  samples: number,
  botSeed: number,
  features: HeuristicV2Features = V3_FEATURES,
  latencySink?: number[],
) {
  const botRng = createPRNG(botSeed);
  const rng: Rng = () => botRng.next();

  return (view: PlayerView): Action | null => {
    const t0 = performance.now();
    // 1. Decisão heurística do v3 (lida com truco/mão de onze e raises)
    const heurAction = decideHeuristicV3Action(view, rng, features);
    if (!heurAction) {
      if (latencySink) latencySink.push(performance.now() - t0);
      return null;
    }

    if (heurAction.type === "truco" || heurAction.type === "elevenDecision") {
      if (latencySink) latencySink.push(performance.now() - t0);
      return heurAction;
    }

    const cardActions = view.legalActions.filter(
      (a) => a.type === "playCard" || a.type === "playHiddenCard",
    );
    if (cardActions.length <= 1) {
      if (latencySink) latencySink.push(performance.now() - t0);
      return cardActions[0] ?? heurAction;
    }

    const res = decideMonteCarloAction(
      { ...view, legalActions: cardActions },
      {
        samples,
        rng,
        rolloutPolicy: (v, r) => decideHeuristicV3Action(v, r, features),
      },
    );
    if (latencySink) latencySink.push(performance.now() - t0);
    return res;
  };
}

function makeV3Policy(botSeed: number) {
  const botRng = createPRNG(botSeed);
  const rng: Rng = () => botRng.next();
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, rng, V3_FEATURES);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

async function main() {
  const blocks: SeedBlock[] = ["train", "train-a", "train-b"];
  const sampleCounts = [16, 32, 64];
  const games = 150; // 150 seeds = 300 partidas espelhadas por bloco (900 partidas total por amostra)

  console.log(`=== E4: PIMC Cards + V3 Truco vs Heuristic V3 (E3) ===`);
  console.log(
    `Partidas por bloco: ${games * 2} (${games} seeds espelhadas, 3 blocos = ${games * 6} partidas)\n`,
  );

  for (const samples of sampleCounts) {
    console.log(`--- Testando PIMC com ${samples} determinizações ---`);
    const blockResults: number[] = [];
    const latencies: number[] = [];

    for (const block of blocks) {
      const seed = SEED_BLOCKS[block];
      const t0 = performance.now();

      const res = runArena({
        games,
        seed,
        mirrored: true,
        policyTeam0: makePimcCardsV3Truco(
          samples,
          seed + 1,
          V3_FEATURES,
          latencies,
        ),
        policyTeam1: makeV3Policy(seed + 2),
      });

      const elapsedSec = (performance.now() - t0) / 1000;
      const gamesPerSec = (res.completed / elapsedSec).toFixed(1);
      blockResults.push(res.winRateTeam0);

      console.log(
        `  ${block.padEnd(8)}: PIMC wr = ${pct(res.winRateTeam0)} ` +
          `[IC95 ${pct(res.winRateTeam0CI95.lo)}–${pct(res.winRateTeam0CI95.hi)}] ` +
          `(${elapsedSec.toFixed(1)}s, ${gamesPerSec} jogos/s)`,
      );
    }

    const mean = blockResults.reduce((a, b) => a + b, 0) / blockResults.length;
    const min = Math.min(...blockResults);

    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const meanLat =
      latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length);

    console.log(
      `  Resumo ${samples} amostras: Média = ${pct(mean)}, Pior bloco = ${pct(min)}`,
    );
    console.log(
      `  Latência por decisão (N=${latencies.length}): mean=${meanLat.toFixed(2)}ms, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms\n`,
    );
  }
}

main().catch(console.error);
