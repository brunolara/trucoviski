#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/* E2: mede uma flag determinística contra o v3 sem essa flag.        */
/* ------------------------------------------------------------------ */

import { createPRNG, runArena } from "../packages/engine/src/index.js";
import type { PlayerView, Action } from "../packages/engine/src/index.js";
import {
  decideHeuristicV3Action,
  V3_FEATURES,
} from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";
import {
  SEED_BLOCKS,
  assertSeedBlockAllowed,
  type SeedBlock,
} from "./bot-policies.mts";

function parseArgv(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i]?.startsWith("--")) continue;
    const key = (argv[i] ?? "--").slice(2);
    const value = argv[i + 1]?.startsWith("--")
      ? "true"
      : (argv[i + 1] ?? "true");
    args[key] = value;
    if (value !== "true") i++;
  }
  return args;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function makePolicy(
  features: HeuristicV2Features,
  botSeed: number,
): (view: PlayerView) => Action | null {
  const botRng = createPRNG(botSeed);
  return (view) => decideHeuristicV3Action(view, () => botRng.next(), features);
}

const args = parseArgv(process.argv.slice(2));
const flagName = args.flag;
if (!flagName) {
  throw new Error("Uso: pnpm tsx scripts/e2-arena.mts -- --flag nome");
}

if (!(flagName in V3_FEATURES)) {
  throw new Error(`Flag desconhecida: ${flagName}`);
}

const flag = flagName as keyof HeuristicV2Features;
if (typeof V3_FEATURES[flag] !== "boolean") {
  throw new Error(`A flag não é booleana: ${flagName}`);
}

const games = Number.parseInt(args.games ?? "4000", 10);
if (!Number.isInteger(games) || games <= 0) {
  throw new Error(`--games inválido: ${args.games ?? ""}`);
}

const blocks = (args.blocks ?? "train,train-a,train-b")
  .split(",")
  .map((block) => block.trim()) as SeedBlock[];
for (const block of blocks) {
  if (!(block in SEED_BLOCKS)) {
    throw new Error(`Bloco desconhecido: ${block}`);
  }
  assertSeedBlockAllowed(block, false);
}

const baseline = {
  ...V3_FEATURES,
  [flag]: false,
} as HeuristicV2Features;
const variant = {
  ...V3_FEATURES,
  [flag]: true,
} as HeuristicV2Features;

const results: Array<{
  block: SeedBlock;
  variantRate: number;
  ciLo: number;
  ciHi: number;
  n: number;
}> = [];

console.log(
  `E2 arena: v3 sem ${flagName} (A) vs v3 com ${flagName} (B) — ${games} seeds/bloco, espelhado`,
);

for (const block of blocks) {
  const seed = SEED_BLOCKS[block];
  const result = runArena({
    games,
    seed,
    mirrored: true,
    policyTeam0: makePolicy(baseline, seed + 1),
    policyTeam1: makePolicy(variant, seed + 2),
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("\n"));
  }

  const ci = result.winRateTeam0CI95;
  const variantRate = 1 - result.winRateTeam0;
  const row = {
    block,
    variantRate,
    ciLo: 1 - ci.hi,
    ciHi: 1 - ci.lo,
    n: ci.n,
  };
  results.push(row);
  console.log(
    `  ${block}: variante ${pct(row.variantRate)}  IC95 ${pct(row.ciLo)}–${pct(row.ciHi)} (n=${row.n})`,
  );
}

const mean =
  results.reduce((sum, result) => sum + result.variantRate, 0) / results.length;
const worst = results.reduce((current, result) =>
  result.variantRate < current.variantRate ? result : current,
);
console.log(
  `Resumo: média ${pct(mean)}  pior ${pct(worst.variantRate)} (${worst.block})`,
);
