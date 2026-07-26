#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  E1 — mede W(a, b, dealer) e emite packages/bots/src/wtable.ts      */
/* ------------------------------------------------------------------ */

import { writeFileSync } from "node:fs";
import { createPRNG, runArena } from "../packages/engine/src/index.js";
import type { Action, PlayerView, Seat } from "../packages/engine/src/index.js";
import {
  decideHeuristicV3Action,
  V3_FEATURES,
} from "../packages/bots/src/index.js";

const N = parseInt(process.argv[2] ?? "2000", 10);
const SEED = parseInt(process.argv[3] ?? "42", 10);
const OUT = process.argv[4] ?? "packages/bots/src/wtable.ts";

function makeV3(botSeed: number) {
  const rng = createPRNG(botSeed);
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, () => rng.next(), V3_FEATURES);
}

/** W[a][b][dealer] = P(time 0 vence | scores=[a,b], dealerSeat=dealer). */
const W: number[][][] = [];

const t0 = performance.now();
let cells = 0;
const total = 13 * 13 * 2;

for (let a = 0; a <= 12; a++) {
  W[a] = [];
  for (let b = 0; b <= 12; b++) {
    W[a]![b] = [];
    for (let dealer = 0; dealer <= 1; dealer++) {
      cells++;
      if (a >= 12) {
        W[a]![b]![dealer] = 1;
        continue;
      }
      if (b >= 12) {
        W[a]![b]![dealer] = 0;
        continue;
      }
      const r = runArena({
        games: N,
        seed: SEED + a * 1000 + b * 10 + dealer,
        mirrored: false,
        initialScores: [a, b],
        initialDealerSeat: dealer as Seat,
        policyTeam0: makeV3(SEED + 11 + a + b + dealer),
        policyTeam1: makeV3(SEED + 12 + a + b + dealer),
      });
      W[a]![b]![dealer] = r.winRateTeam0;
      if (cells % 20 === 0 || cells === total) {
        const elapsed = (performance.now() - t0) / 1000;
        console.error(
          `  ${cells}/${total} W(${a},${b},${dealer})=${r.winRateTeam0.toFixed(3)} ` +
            `(${elapsed.toFixed(0)}s, ${(cells / elapsed).toFixed(1)} cells/s)`,
        );
      }
    }
  }
}

function sanity(): string[] {
  const issues: string[] = [];
  // W(a,a,d) ≈ 0.5 (±0.04: vantagem do dealer + SE @ N=2k)
  for (let a = 0; a <= 11; a++) {
    for (let d = 0; d <= 1; d++) {
      const w = W[a]![a]![d]!;
      if (Math.abs(w - 0.5) > 0.04) {
        issues.push(`W(${a},${a},${d})=${w.toFixed(3)} (esperado 0.50±0.04)`);
      }
    }
  }
  for (const d of [0, 1]) {
    if (W[11]![0]![d]! <= 0.95) {
      issues.push(`W(11,0,${d})=${W[11]![0]![d]!.toFixed(3)} (esperado >0.95)`);
    }
    if (W[0]![11]![d]! >= 0.05) {
      issues.push(`W(0,11,${d})=${W[0]![11]![d]!.toFixed(3)} (esperado <0.05)`);
    }
  }
  // monotonicidade em a (não-decrescente) e b (não-crescente)
  for (let d = 0; d <= 1; d++) {
    for (let b = 0; b <= 11; b++) {
      for (let a = 0; a < 11; a++) {
        if (W[a + 1]![b]![d]! + 0.03 < W[a]![b]![d]!) {
          issues.push(
            `mono-a W(${a + 1},${b},${d})=${W[a + 1]![b]![d]!.toFixed(3)} < W(${a},${b},${d})=${W[a]![b]![d]!.toFixed(3)}`,
          );
        }
      }
    }
    for (let a = 0; a <= 11; a++) {
      for (let b = 0; b < 11; b++) {
        if (W[a]![b + 1]![d]! - 0.03 > W[a]![b]![d]!) {
          issues.push(
            `mono-b W(${a},${b + 1},${d})=${W[a]![b + 1]![d]!.toFixed(3)} > W(${a},${b},${d})=${W[a]![b]![d]!.toFixed(3)}`,
          );
        }
      }
    }
  }
  // simetria: W(a,b,0)+W(b,a,1)≈1
  let symErr = 0;
  let symN = 0;
  for (let a = 0; a <= 11; a++) {
    for (let b = 0; b <= 11; b++) {
      const s = W[a]![b]![0]! + W[b]![a]![1]!;
      symErr += Math.abs(s - 1);
      symN++;
      if (Math.abs(s - 1) > 0.06) {
        issues.push(`simetria W(${a},${b},0)+W(${b},${a},1)=${s.toFixed(3)}`);
      }
    }
  }
  console.error(
    `simetria média |sum-1|=${(symErr / symN).toFixed(4)}; ` +
      `W(11,0,0)=${W[11]![0]![0]!.toFixed(3)} W(0,11,0)=${W[0]![11]![0]!.toFixed(3)} ` +
      `W(5,5,0)=${W[5]![5]![0]!.toFixed(3)}`,
  );
  return issues;
}

const issues = sanity();
if (issues.length > 0) {
  console.error(`SANITY FAIL (${issues.length}):`);
  for (const i of issues.slice(0, 30)) console.error(`  ${i}`);
  process.exitCode = 1;
} else {
  console.error("SANITY OK");
}

const fmt = (n: number) => n.toFixed(4);
const body = W.map(
  (rowA) =>
    `  [\n${rowA
      .map((rowB) => `    [${rowB.map(fmt).join(", ")}]`)
      .join(",\n")},\n  ]`,
).join(",\n");

const src = `/* eslint-disable */
/* Gerado por scripts/build-wtable.mts — não edite à mão. */
/** W[a][b][dealer] = P(time 0 vence a partida | scores=[a,b], dealerSeat=dealer). */
export const W_TABLE: number[][][] = [
${body},
];

/** Probabilidade do time \`team\` vencer a partida a partir do placar atual. */
export function matchWinProb(
  scores: readonly [number, number],
  team: 0 | 1,
  dealerSeat: number,
): number {
  const a = Math.min(12, Math.max(0, scores[0]!));
  const b = Math.min(12, Math.max(0, scores[1]!));
  const d = dealerSeat & 1;
  const w0 = W_TABLE[a]![b]![d]!;
  return team === 0 ? w0 : 1 - w0;
}
`;

writeFileSync(OUT, src);
console.error(
  `wrote ${OUT} (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
);
