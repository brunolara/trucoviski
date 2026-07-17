#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Script: pnpm arena -- --a heuristic-v2 --b heuristic-v1 --games 3000 */
/*  Arena de medição (F0): pita duas políticas de bot e reporta winrate. */
/* ------------------------------------------------------------------ */

import { createPRNG, runArena } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideMonteCarloAction,
} from "../packages/bots/src/index.js";

type PolicyName = "random" | "heuristic-v1" | "heuristic-v2" | "montecarlo";

function makePolicy(
  name: PolicyName,
  botSeed: number,
): (view: PlayerView) => Action | null {
  const botRng = createPRNG(botSeed);
  const rng = () => botRng.next();
  switch (name) {
    case "random":
      return () => null; // runArena já cai para ação aleatória quando a política retorna null
    case "heuristic-v1":
      return decideHeuristicAction;
    case "heuristic-v2":
      return (view) => decideHeuristicV2Action(view, rng);
    case "montecarlo":
      return (view) => decideMonteCarloAction(view, { samples: 60, rng });
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

const args = parseArgv(process.argv.slice(2));
const a = (args.a ?? "heuristic-v2") as PolicyName;
const b = (args.b ?? "heuristic-v1") as PolicyName;
const games = parseInt(args.games ?? "2000", 10);
const seed = parseInt(args.seed ?? "42", 10);

console.log(
  `Arena: ${a} (Time 0) vs ${b} (Time 1) — ${games} jogos (seed ${seed})`,
);

const start = performance.now();
const result = runArena({
  games,
  seed,
  policyTeam0: makePolicy(a, seed + 1),
  policyTeam1: makePolicy(b, seed + 2),
});
const elapsed = ((performance.now() - start) / 1000).toFixed(2);

console.log(`\nConcluído em ${elapsed}s`);
console.log(`  Jogos:        ${result.games}`);
console.log(`  Completados:  ${result.completed}`);
console.log(`  Timed out:    ${result.timedOut}`);
console.log(
  `  ${a} (T0):    ${result.team0Wins} (${(result.winRateTeam0 * 100).toFixed(2)}%)`,
);
console.log(
  `  ${b} (T1):    ${result.team1Wins} (${((1 - result.winRateTeam0) * 100).toFixed(2)}%)`,
);

if (result.errors.length > 0) {
  console.log(`\n  Erros:`);
  for (const err of result.errors) console.log(`    ${err}`);
  process.exit(1);
}
