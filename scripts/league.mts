#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Liga: matriz de confrontos espelhados + IC pareado + pior confronto */
/*  pnpm league -- --games 2000 --blocks train,train-a,train-b         */
/* ------------------------------------------------------------------ */

import { runArena } from "../packages/engine/src/index.js";
import {
  LEAGUE_POLICIES,
  SEED_BLOCKS,
  assertSeedBlockAllowed,
  makePolicy,
  type PolicyName,
  type SeedBlock,
} from "./bot-policies.mts";

export interface LeagueCell {
  a: PolicyName;
  b: PolicyName;
  block: SeedBlock;
  winRate: number;
  ciLo: number;
  ciHi: number;
  n: number;
  completed: number;
}

export interface LeagueResult {
  games: number;
  blocks: SeedBlock[];
  cells: LeagueCell[];
  /** Média de winrate de cada política contra as outras, pelos blocos. */
  meanByPolicy: Record<string, number>;
  worstByPolicy: Record<string, { vs: PolicyName; winRate: number }>;
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

function pairs(names: readonly PolicyName[]): Array<[PolicyName, PolicyName]> {
  const out: Array<[PolicyName, PolicyName]> = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      if (a === undefined || b === undefined) continue;
      out.push([a, b]);
    }
  }
  return out;
}

export function runLeague(opts: {
  games: number;
  blocks: SeedBlock[];
  policies?: readonly PolicyName[];
  unlockHoldout?: boolean;
}): LeagueResult {
  const policies = opts.policies ?? LEAGUE_POLICIES;
  for (const b of opts.blocks) {
    assertSeedBlockAllowed(b, opts.unlockHoldout === true);
  }

  const cells: LeagueCell[] = [];
  for (const block of opts.blocks) {
    const seed = SEED_BLOCKS[block];
    for (const [a, b] of pairs(policies)) {
      const result = runArena({
        games: opts.games,
        seed,
        mirrored: true,
        policyTeam0: makePolicy(a, seed + 1),
        policyTeam1: makePolicy(b, seed + 2),
      });
      if (result.errors.length > 0) {
        throw new Error(result.errors.join("\n"));
      }
      cells.push({
        a,
        b,
        block,
        winRate: result.winRateTeam0,
        ciLo: result.winRateTeam0CI95.lo,
        ciHi: result.winRateTeam0CI95.hi,
        n: result.winRateTeam0CI95.n,
        completed: result.completed,
      });
    }
  }

  const meanByPolicy: Record<string, number> = {};
  const worstByPolicy: Record<string, { vs: PolicyName; winRate: number }> = {};
  for (const p of policies) {
    const rates: number[] = [];
    let worst: { vs: PolicyName; winRate: number } | undefined;
    for (const c of cells) {
      let wr: number | undefined;
      let vs: PolicyName | undefined;
      if (c.a === p) {
        wr = c.winRate;
        vs = c.b;
      } else if (c.b === p) {
        wr = 1 - c.winRate;
        vs = c.a;
      }
      if (wr === undefined || vs === undefined) continue;
      rates.push(wr);
      if (!worst || wr < worst.winRate) worst = { vs, winRate: wr };
    }
    meanByPolicy[p] =
      rates.length > 0 ? rates.reduce((s, x) => s + x, 0) / rates.length : 0;
    if (worst) worstByPolicy[p] = worst;
  }

  return {
    games: opts.games,
    blocks: opts.blocks,
    cells,
    meanByPolicy,
    worstByPolicy,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function printLeague(result: LeagueResult): void {
  const policies = [
    ...new Set(result.cells.flatMap((c) => [c.a, c.b])),
  ] as PolicyName[];

  console.log(
    `Liga: ${result.games} seeds/confronto, blocos ${result.blocks.join(", ")} (espelhado, IC pareado)`,
  );

  for (const block of result.blocks) {
    console.log(`\nBloco ${block} (seed ${SEED_BLOCKS[block]}):`);
    const header = [
      "A \\ B",
      ...policies.map((p) => p.replace("heuristic-", "")),
    ];
    console.log(header.join("\t"));
    for (const a of policies) {
      const row = [a.replace("heuristic-", "")];
      for (const b of policies) {
        if (a === b) {
          row.push("—");
          continue;
        }
        const cell = result.cells.find(
          (c) =>
            c.block === block &&
            ((c.a === a && c.b === b) || (c.a === b && c.b === a)),
        );
        if (!cell) {
          row.push("?");
          continue;
        }
        const wr = cell.a === a ? cell.winRate : 1 - cell.winRate;
        row.push(pct(wr));
      }
      console.log(row.join("\t"));
    }
  }

  console.log("\nResumo (média nos blocos e confrontos):");
  for (const p of policies) {
    const mean = result.meanByPolicy[p] ?? 0;
    const worst = result.worstByPolicy[p];
    const worstStr = worst
      ? `pior ${pct(worst.winRate)} vs ${worst.vs.replace("heuristic-", "")}`
      : "";
    console.log(`  ${p}: média ${pct(mean)}  ${worstStr}`);
  }

  const cellsByPair = new Map<string, LeagueCell[]>();
  for (const c of result.cells) {
    const key = `${c.a}|${c.b}`;
    const list = cellsByPair.get(key) ?? [];
    list.push(c);
    cellsByPair.set(key, list);
  }
  console.log("\nConfrontos (média dos blocos; IC95 de cada bloco):");
  for (const [key, list] of cellsByPair) {
    if (list.length === 0) continue;
    const mean = list.reduce((s, c) => s + c.winRate, 0) / list.length;
    const worst = list.reduce((w, c) => (c.winRate < w.winRate ? c : w));
    console.log(
      `  ${key.replace("|", " vs ")}: média ${pct(mean)}  pior ${pct(worst.winRate)} (${worst.block})`,
    );
    for (const c of list) {
      console.log(
        `    ${c.block}: ${pct(c.winRate)}  IC95 ${pct(c.ciLo)}–${pct(c.ciHi)} n=${c.n}`,
      );
    }
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("league.mts") ||
    process.argv[1].endsWith("league.js"));

if (isMain) {
  const args = parseArgv(process.argv.slice(2));
  const games = parseInt(args.games ?? "2000", 10);
  const blocks = (args.blocks ?? "train,train-a,train-b")
    .split(",")
    .map((s) => s.trim()) as SeedBlock[];
  for (const b of blocks) {
    if (!(b in SEED_BLOCKS)) {
      console.error(`Bloco desconhecido: ${b}`);
      process.exit(1);
    }
  }
  const start = performance.now();
  const result = runLeague({
    games,
    blocks,
    unlockHoldout: args["unlock-holdout"] === "true",
  });
  printLeague(result);
  console.log(
    `\nConcluído em ${((performance.now() - start) / 1000).toFixed(1)}s`,
  );
}
