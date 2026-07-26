#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Script: pnpm arena -- --a heuristic-v3 --b heuristic-v2 --games 2000 */
/*  Arena de medição: pita duas políticas e reporta winrate + diagnóstico. */
/* ------------------------------------------------------------------ */

import { createPRNG, runArena } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  decideMonteCarloAction,
  DEFAULT_FEATURES,
  V3_FEATURES,
} from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

type PolicyName =
  "random" | "heuristic-v1" | "heuristic-v2" | "heuristic-v3" | "montecarlo";

const SEED_BLOCKS = {
  train: 42,
  test: 1_000_003,
} as const;

function makePolicy(
  name: PolicyName,
  botSeed: number,
  features?: HeuristicV2Features,
): (view: PlayerView) => Action | null {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  switch (name) {
    case "random":
      return () => null;
    case "heuristic-v1":
      return decideHeuristicAction;
    case "heuristic-v2":
      return (view) =>
        decideHeuristicV2Action(view, rng, features ?? DEFAULT_FEATURES);
    case "heuristic-v3":
      return (view) =>
        decideHeuristicV3Action(view, rng, features ?? V3_FEATURES);
    case "montecarlo":
      return (view) => decideMonteCarloAction(view, { rng });
  }
}

function parseArgv(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]?.startsWith("--")) {
      const key = (argv[i] ?? "--").slice(2);
      const val = argv[i + 1]?.startsWith("--")
        ? "true"
        : (argv[i + 1] ?? "true");
      args[key] = val;
      if (val !== "true") i++;
    }
  }
  return args;
}

function parseFeatures(
  json: string | undefined,
): HeuristicV2Features | undefined {
  if (!json) return undefined;
  const partial = JSON.parse(json) as Partial<HeuristicV2Features>;
  return { ...DEFAULT_FEATURES, ...partial };
}

const args = parseArgv(process.argv.slice(2));
const a = (args.a ?? "heuristic-v2") as PolicyName;
const b = (args.b ?? "heuristic-v1") as PolicyName;
const games = parseInt(args.games ?? "2000", 10);
const seedBlock = (args["seed-block"] ?? "train") as keyof typeof SEED_BLOCKS;
const seed = parseInt(
  args.seed ?? String(SEED_BLOCKS[seedBlock] ?? SEED_BLOCKS.train),
  10,
);
const mirrored = args.mirrored !== "false";
const featuresA = parseFeatures(args["features-a"]);
const featuresB = parseFeatures(args["features-b"]);

console.log(
  `Arena: ${a} (A) vs ${b} (B) — ${games} seeds` +
    `${mirrored ? " espelhadas" : ""} (seed ${seed}, block ${seedBlock})`,
);

const start = performance.now();
const result = runArena({
  games,
  seed,
  mirrored,
  policyTeam0: makePolicy(a, seed + 1, featuresA),
  policyTeam1: makePolicy(b, seed + 2, featuresB),
});
const elapsed = ((performance.now() - start) / 1000).toFixed(2);
const d = result.diagnostics;

console.log(
  `\nConcluído em ${elapsed}s (${result.gamesPerSecond.toFixed(0)} partidas/s)`,
);
console.log(`  Seeds:        ${result.games}`);
console.log(`  Partidas:     ${result.matchesPlayed}`);
console.log(`  Completados:  ${result.completed}`);
console.log(`  Timed out:    ${result.timedOut}`);
console.log(
  `  ${a} (A):    ${result.team0Wins} (${(result.winRateTeam0 * 100).toFixed(2)}%)`,
);
console.log(
  `  ${b} (B):    ${result.team1Wins} (${((1 - result.winRateTeam0) * 100).toFixed(2)}%)`,
);
console.log(`\nDiagnóstico:`);
console.log(`  Fechamentos por valor: ${JSON.stringify(d.closingHandValues)}`);
console.log(`  Fechou em mão de onze: ${d.closingElevenHands}`);
console.log(
  `  A perdeu em mão ≥9: ${d.policy0LossesOnBigHand} | B: ${d.policy1LossesOnBigHand}`,
);
console.log(
  `  Onze jogada e perdida — A: ${d.policy0ElevenPlayedAndLost} | B: ${d.policy1ElevenPlayedAndLost}`,
);
console.log(`  Pontos via run: ${d.pointsFromRun}`);
console.log(`  Accept por nível: ${JSON.stringify(d.trucoAcceptByLevel)}`);
console.log(`  Run por nível: ${JSON.stringify(d.trucoRunByLevel)}`);
console.log(`  Raise por nível: ${JSON.stringify(d.trucoRaiseByLevel)}`);

if (result.errors.length > 0) {
  console.log(`\n  Erros:`);
  for (const err of result.errors) console.log(`    ${err}`);
  process.exit(1);
}
