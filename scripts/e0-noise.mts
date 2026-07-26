#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* E0 — ruído do fitness do sweep (plano-bot-v4-ev.md) */
import { V3_FEATURES } from "../packages/bots/src/index.js";
import { evaluate } from "./sweep-eval.mts";

const SEEDS = Array.from({ length: 20 }, (_, i) => 42 + i * 1009);

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return {
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}

function run(games: number) {
  const fitness: number[] = [];
  const wr: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i]!;
    const r = evaluate(V3_FEATURES, games, seed);
    fitness.push(r.fitness);
    wr.push(r.wrVsV2);
    console.error(
      `[${games}] ${i + 1}/${SEEDS.length} seed=${seed} fitness=${r.fitness.toFixed(4)} wrVsV2=${r.wrVsV2.toFixed(4)} discarded=${r.discarded}`,
    );
  }
  const valid = fitness.filter((f) => f >= 0);
  console.log(
    JSON.stringify(
      {
        games,
        n: SEEDS.length,
        fitness: stats(valid.length > 1 ? valid : fitness),
        wrVsV2: stats(wr),
        discarded: fitness.filter((f) => f < 0).length,
        elapsedSec: (performance.now() - t0) / 1000,
      },
      null,
      2,
    ),
  );
}

run(2000);
run(20_000);
