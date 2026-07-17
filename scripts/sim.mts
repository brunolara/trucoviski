#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Script: pnpm sim -- --games N                                     */
/*  Executa simulação determinística com ações aleatórias legais.     */
/* ------------------------------------------------------------------ */

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

const gameCount = parseInt(args.games ?? "1000", 10);
const baseSeed = parseInt(args.seed ?? "42", 10);
const maxActions = parseInt(args["max-actions"] ?? "5000", 10);
const verbose = args.verbose === "true";

async function main() {
  const { runSimulation } =
    await import("../packages/engine/src/simulation.js");

  console.log(
    `Running ${gameCount} games (seed base: ${baseSeed}, max actions: ${maxActions})...`,
  );

  const start = performance.now();
  const result = runSimulation({
    games: gameCount,
    seed: baseSeed,
    maxActions,
    onProgress: verbose
      ? (completed, total) => {
          if (total % 100 === 0) {
            console.log(
              `  ... ${total}/${gameCount} games (${completed} completed, ${total - completed} timed out)`,
            );
          }
        }
      : undefined,
  });
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  console.log(`\nDone in ${elapsed}s\n`);
  console.log(`  Games:       ${result.games}`);
  console.log(`  Completed:   ${result.completed}`);
  console.log(`  Timed out:   ${result.timedOut}`);
  console.log(`  Avg actions: ${result.averageActions.toFixed(1)}`);
  console.log(`  Avg hands:   ${result.averageHands.toFixed(1)}`);
  console.log(`  Team 0 wins: ${result.team0Wins}`);
  console.log(`  Team 1 wins: ${result.team1Wins}`);

  if (result.stuckSeeds.length > 0) {
    console.log(`\n  Stuck seeds: ${result.stuckSeeds.join(", ")}`);
  }
  if (result.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const err of result.errors) {
      console.log(`    ${err}`);
    }
  }

  if (result.timedOut > 0 || result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
