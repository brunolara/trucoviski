#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Varredura de parâmetros do bot v3 (F3 + F5)                        */
/*  Fitness = wr_vs_v2 − selfPlayBigRate×0.15, com restrição dura vs v1 */
/* ------------------------------------------------------------------ */

import { fork, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createPRNG } from "../packages/engine/src/index.js";
import { V3_FEATURES } from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";
import { evaluate, V2_VS_V1_BASELINE } from "./sweep-eval.mts";
import type { CandidateResult } from "./sweep-eval.mts";
import { climbChain, KNOB_RANGES } from "./sweep-climb.mts";
import type { KnobKey } from "./sweep-climb.mts";

const TRAIN_SEED = 42;
const TEST_SEED = 1_000_003;

const WORKER = fileURLToPath(new URL("./sweep-worker.mts", import.meta.url));
const DEFAULT_POOL = Math.max(1, Math.min(cpus().length - 2, 10));

const FLAG_KEYS = [
  "elevenNeedsPair",
  "positionAware",
  "raiseGuard",
  "distanceToTwelve",
  "softOverrides",
  "topTwoStrength",
] as const;

interface EvalJob {
  kind: "eval";
  features: HeuristicV2Features;
  games: number;
  seed: number;
  vsV2Only?: boolean;
}

interface ClimbJob {
  kind: "climb";
  start: CandidateResult;
  games: number;
  seed: number;
  vsV2Only?: boolean;
}

type PoolJob = EvalJob | ClimbJob;

interface EvalPoolResult {
  kind: "eval";
  result: CandidateResult;
  elapsedMs: number;
}

interface ClimbPoolResult {
  kind: "climb";
  result: CandidateResult;
  evals: number;
  discarded: number;
  elapsedMs: number;
}

type PoolResult = EvalPoolResult | ClimbPoolResult;

/**
 * Avalia `jobs` em paralelo e devolve os resultados NA MESMA ORDEM da entrada.
 * A ordem importa: o sweep desempata por posição e precisa ser determinístico.
 */
function runPool(jobs: PoolJob[], poolSize: number): Promise<PoolResult[]> {
  if (jobs.length === 0) return Promise.resolve([]);
  // Um job só: evita fork overhead (ex.: vizinho único / climb-top 1).
  if (jobs.length === 1) {
    const j = jobs[0]!;
    const t0 = performance.now();
    if (j.kind === "climb") {
      const c = climbChain(j.start, j.games, j.seed, j.vsV2Only === true);
      return Promise.resolve([
        {
          kind: "climb",
          result: c.result,
          evals: c.evals,
          discarded: c.discarded,
          elapsedMs: performance.now() - t0,
        },
      ]);
    }
    return Promise.resolve([
      {
        kind: "eval",
        result: evaluate(j.features, j.games, j.seed, {
          vsV2Only: j.vsV2Only === true,
        }),
        elapsedMs: performance.now() - t0,
      },
    ]);
  }
  return new Promise((resolve, reject) => {
    const results: PoolResult[] = new Array(jobs.length);
    let next = 0;
    let done = 0;
    const workers: ChildProcess[] = [];
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      workers.forEach((w) => w.kill());
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      workers.forEach((w) => w.kill());
      for (let i = 0; i < results.length; i++) {
        if (results[i] == null) {
          fail(new Error(`runPool: missing result for job ${i}`));
          return;
        }
      }
      resolve(results);
    };

    const feed = (w: ChildProcess) => {
      if (next >= jobs.length) return;
      const id = next++;
      w.send({ id, ...jobs[id]! });
    };

    for (let i = 0; i < Math.min(poolSize, jobs.length); i++) {
      const w = fork(WORKER, [], { execArgv: ["--import", "tsx"] });
      workers.push(w);
      w.on(
        "message",
        (msg: {
          type: string;
          id?: number;
          kind?: string;
          result?: CandidateResult;
          evals?: number;
          discarded?: number;
          elapsedMs?: number;
          error?: string;
        }) => {
          if (msg.type === "ready") {
            feed(w);
            return;
          }
          if (msg.type === "error") {
            fail(new Error(`worker job ${msg.id}: ${msg.error}`));
            return;
          }
          if (msg.type !== "result" || msg.id == null || msg.result == null) {
            fail(
              new Error(
                `worker sent unexpected message: ${JSON.stringify(msg)}`,
              ),
            );
            return;
          }
          if (msg.kind === "climb") {
            results[msg.id] = {
              kind: "climb",
              result: msg.result,
              evals: msg.evals ?? 0,
              discarded: msg.discarded ?? 0,
              elapsedMs: msg.elapsedMs ?? 0,
            };
          } else {
            results[msg.id] = {
              kind: "eval",
              result: msg.result,
              elapsedMs: msg.elapsedMs ?? 0,
            };
          }
          done++;
          if (done === jobs.length) succeed();
          else feed(w);
        },
      );
      w.on("error", (e) => fail(e));
      w.on("exit", (code, signal) => {
        if (settled) return;
        if (code !== 0 && code !== null) {
          fail(new Error(`worker exited code=${code} signal=${signal}`));
        }
      });
    }
  });
}

async function evaluateAll(
  jobs: {
    features: HeuristicV2Features;
    games: number;
    seed: number;
    vsV2Only?: boolean;
  }[],
  poolSize: number,
): Promise<{
  results: CandidateResult[];
  elapsedMs: number;
  discarded: number;
}> {
  const pool = await runPool(
    jobs.map((j) => ({ kind: "eval" as const, ...j })),
    poolSize,
  );
  let elapsedMs = 0;
  let discarded = 0;
  const results: CandidateResult[] = [];
  for (const r of pool) {
    if (r.kind !== "eval")
      throw new Error("evaluateAll: unexpected climb result");
    results.push(r.result);
    elapsedMs += r.elapsedMs;
    if (r.result.discarded) discarded++;
  }
  return { results, elapsedMs, discarded };
}

async function climbAll(
  jobs: {
    start: CandidateResult;
    games: number;
    seed: number;
    vsV2Only?: boolean;
  }[],
  poolSize: number,
): Promise<ClimbPoolResult[]> {
  const pool = await runPool(
    jobs.map((j) => ({ kind: "climb" as const, ...j })),
    poolSize,
  );
  return pool.map((r, i) => {
    if (r.kind !== "climb")
      throw new Error(`climbAll: unexpected eval at ${i}`);
    return r;
  });
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

function randomFeatures(rng: () => number): HeuristicV2Features {
  const f: HeuristicV2Features = { ...V3_FEATURES };
  // F5.6: sortear flags no coarse
  for (const flag of FLAG_KEYS) {
    (f as unknown as Record<string, boolean>)[flag] = rng() < 0.5;
  }
  for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
    const { min, max, step } = KNOB_RANGES[key];
    const n = Math.floor((max - min) / step) + 1;
    const idx = Math.min(n - 1, Math.floor(rng() * n));
    (f as unknown as Record<string, number>)[key] = Number(
      (min + idx * step).toFixed(4),
    );
  }
  return f;
}

function formatPct(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "n/a";
}

function flagsSummary(f: HeuristicV2Features): string {
  return FLAG_KEYS.map((k) => (f[k] ? k[0] : ".")).join("");
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const coarseN = parseInt(args.coarse ?? "200", 10);
  // E0: 10k (era 2k) — SE de fitness a 2k ≈ aceite 1e-6; ver docs/plano-bot-v4-ev.md
  const coarseGames = parseInt(args["coarse-games"] ?? "10000", 10);
  const climbTop = parseInt(args["climb-top"] ?? "10", 10);
  const confirmTop = parseInt(args["confirm-top"] ?? "5", 10);
  const confirmGames = parseInt(args["confirm-games"] ?? "20000", 10);
  const sweepSeed = parseInt(args.seed ?? "7", 10);
  const poolSize = parseInt(args.pool ?? String(DEFAULT_POOL), 10);
  const skipAblation = args["skip-ablation"] === "true";
  const vsV2Only = args["vs-v2-only"] === "true";
  const outPath = args.out ?? "docs/v3-sweep-result.json";

  const sweepRng = createPRNG(sweepSeed);
  const rng = () => sweepRng.next();

  console.log(
    `Sweep: coarse=${coarseN}×${coarseGames}, climb top ${climbTop}, confirm top ${confirmTop}×${confirmGames} (pool=${poolSize})` +
      (vsV2Only ? " [vs-v2-only]" : ""),
  );
  console.log(
    vsV2Only
      ? `  fitness = wrVsV2 (sem vsV1/self)`
      : `  constraint: vsV1 ≥ ${formatPct(V2_VS_V1_BASELINE)} − tol; fitness = wrVsV2 − selfPlayBig×0.15`,
  );

  const t0 = performance.now();
  let totalEvals = 0;
  let totalCpuMs = 0;
  const phaseWall: Record<string, number> = {};
  const phaseDiscard: Record<string, number> = {};

  // --- Coarse ---
  const tCoarse = performance.now();
  const candidates = Array.from({ length: coarseN }, () => ({
    features: randomFeatures(rng),
    games: coarseGames,
    seed: TRAIN_SEED,
    vsV2Only,
  }));
  const coarseOut = await evaluateAll(candidates, poolSize);
  const coarse = coarseOut.results;
  totalEvals += coarseN;
  totalCpuMs += coarseOut.elapsedMs;
  phaseWall.coarse = (performance.now() - tCoarse) / 1000;
  phaseDiscard.coarse = coarseOut.discarded;
  {
    const viable = coarse.filter((c) => !c.discarded);
    const best = [...viable].sort((a, b) => b.fitness - a.fitness)[0];
    const flagSample = flagsSummary(
      candidates[candidates.length - 1]!.features,
    );
    console.log(
      `  coarse ${coarseN}/${coarseN}: ` +
        (best
          ? `fitness=${best.fitness.toFixed(4)} vsV2=${formatPct(best.wrVsV2)} vsV1=${formatPct(best.wrVsV1)} self≥9=${(best.selfPlayBigRate * 100).toFixed(1)}%`
          : "nenhum viável ainda") +
        ` discard=${coarseOut.discarded} flagsSample=${flagSample} ` +
        `(${phaseWall.coarse.toFixed(0)}s)`,
    );
  }

  coarse.sort((a, b) => b.fitness - a.fitness);
  const seeds = coarse.filter((c) => !c.discarded).slice(0, climbTop);
  console.log(
    `\nHill climb on top ${seeds.length}/${climbTop} viable (≤40 evals each, 1 chain/worker)…`,
  );

  // --- Climb (um chain por worker) ---
  const tClimb = performance.now();
  const climbOut = await climbAll(
    seeds.map((s) => ({
      start: s,
      games: coarseGames,
      seed: TRAIN_SEED,
      vsV2Only,
    })),
    poolSize,
  );
  phaseWall.climb = (performance.now() - tClimb) / 1000;
  let climbEvals = 0;
  let climbDiscarded = 0;
  const climbed: CandidateResult[] = [];
  for (let i = 0; i < climbOut.length; i++) {
    const c = climbOut[i]!;
    climbed.push(c.result);
    climbEvals += c.evals;
    climbDiscarded += c.discarded;
    totalCpuMs += c.elapsedMs;
    console.log(
      `  climb ${i + 1}/${climbOut.length}: fitness=${c.result.fitness.toFixed(4)} ` +
        `vsV2=${formatPct(c.result.wrVsV2)} vsV1=${formatPct(c.result.wrVsV1)} ` +
        `self≥9=${Number.isFinite(c.result.selfPlayBigRate) ? (c.result.selfPlayBigRate * 100).toFixed(1) : "n/a"}% ` +
        `evals=${c.evals} discard=${c.discarded} (${(c.elapsedMs / 1000).toFixed(0)}s)`,
    );
  }
  totalEvals += climbEvals;
  phaseDiscard.climb = climbDiscarded;

  climbed.sort((a, b) => b.fitness - a.fitness);
  const toConfirm = climbed.filter((c) => !c.discarded).slice(0, confirmTop);
  console.log(
    `\nConfirm top ${toConfirm.length} on TEST seeds @ ${confirmGames}…`,
  );

  // --- Confirm ---
  const tConfirm = performance.now();
  const confirmOut = await evaluateAll(
    toConfirm.map((c) => ({
      features: c.features,
      games: confirmGames,
      seed: TEST_SEED,
      vsV2Only,
    })),
    poolSize,
  );
  const confirmed = confirmOut.results;
  totalEvals += confirmed.length;
  totalCpuMs += confirmOut.elapsedMs;
  phaseWall.confirm = (performance.now() - tConfirm) / 1000;
  phaseDiscard.confirm = confirmOut.discarded;
  for (let i = 0; i < confirmed.length; i++) {
    const c = toConfirm[i]!;
    const ev = confirmed[i]!;
    console.log(
      `  confirm ${i + 1}: train_fit=${c.fitness.toFixed(4)} test_fit=${ev.fitness.toFixed(4)} ` +
        `vsV2=${formatPct(ev.wrVsV2)} vsV1=${formatPct(ev.wrVsV1)} ` +
        `self≥9=${(ev.selfPlayBigRate * 100).toFixed(1)}% ` +
        `discard=${ev.discarded}`,
    );
  }

  confirmed.sort((a, b) => b.fitness - a.fitness);
  const winner = confirmed.find((c) => !c.discarded) ?? confirmed[0];
  if (!winner) {
    console.log("\nNenhum candidato viável — abortando.");
    process.exitCode = 2;
    return;
  }

  // Portão: vs v2 ≥ 55% em modo rápido; completo mantém os três da Missão.
  const GATE_VS_V2 = vsV2Only ? 0.55 : 0.535;
  const GATE_VS_V1 = 0.552;
  const GATE_SELF_BIG = 0.317;
  const gateVsV2 = winner.wrVsV2 >= GATE_VS_V2;
  const gateVsV1 = vsV2Only || winner.wrVsV1 >= GATE_VS_V1;
  const gateSelf = vsV2Only || winner.selfPlayBigRate < GATE_SELF_BIG;
  const gatePass = gateVsV2 && gateVsV1 && gateSelf && !winner.discarded;

  console.log(
    `\nWinner: fitness=${winner.fitness.toFixed(4)} vsV2=${formatPct(winner.wrVsV2)} vsV1=${formatPct(winner.wrVsV1)} ` +
      `self≥9=${(winner.selfPlayBigRate * 100).toFixed(1)}% self12=${(winner.selfPlay12Rate * 100).toFixed(1)}%`,
  );
  console.log(
    vsV2Only
      ? `Gate: vsV2≥55% ${gateVsV2 ? "OK" : "FAIL"} → ${gatePass ? "PASS" : "FAIL"}`
      : `Gate: vsV2≥53.5% ${gateVsV2 ? "OK" : "FAIL"} | vsV1≥55.2% ${gateVsV1 ? "OK" : "FAIL"} | self≥9<31.7% ${gateSelf ? "OK" : "FAIL"} → ${gatePass ? "PASS" : "FAIL"}`,
  );
  console.log(JSON.stringify(winner.features, null, 2));

  interface AblationRow {
    flag: string;
    wrVsV2: number;
    wrVsV1: number;
    fitness: number;
    selfPlayBigRate: number;
    deltaFitness: number;
    discarded: boolean;
  }

  const ablation: AblationRow[] = [];
  phaseWall.ablation = 0;
  phaseDiscard.ablation = 0;
  if (!skipAblation && !winner.discarded) {
    console.log(`\nAblation @ ${confirmGames} test…`);
    const tAblation = performance.now();
    const baseline = winner.fitness;
    const ablFlags = FLAG_KEYS.filter((flag) => winner.features[flag]);
    for (const flag of FLAG_KEYS) {
      if (!winner.features[flag]) {
        console.log(`  ${flag}=already off — skip`);
      }
    }
    if (ablFlags.length > 0) {
      const ablOut = await evaluateAll(
        ablFlags.map((flag) => ({
          features: { ...winner.features, [flag]: false },
          games: confirmGames,
          seed: TEST_SEED,
          vsV2Only,
        })),
        poolSize,
      );
      totalEvals += ablOut.results.length;
      totalCpuMs += ablOut.elapsedMs;
      phaseDiscard.ablation = ablOut.discarded;
      for (let i = 0; i < ablFlags.length; i++) {
        const flag = ablFlags[i]!;
        const ev = ablOut.results[i]!;
        const row = {
          flag,
          wrVsV2: ev.wrVsV2,
          wrVsV1: ev.wrVsV1,
          fitness: ev.fitness,
          selfPlayBigRate: ev.selfPlayBigRate,
          deltaFitness: Number.isFinite(baseline)
            ? baseline -
              (Number.isFinite(ev.fitness) ? ev.fitness : baseline - 1)
            : 0,
          discarded: ev.discarded,
        };
        ablation.push(row);
        console.log(
          `  ${flag}=off: fit=${ev.fitness.toFixed(4)} Δ=${row.deltaFitness.toFixed(4)} ` +
            `vsV2=${formatPct(ev.wrVsV2)} vsV1=${formatPct(ev.wrVsV1)} ` +
            `self≥9=${(ev.selfPlayBigRate * 100).toFixed(1)}%` +
            (ev.discarded ? " DISCARD" : ""),
        );
      }
    }
    phaseWall.ablation = (performance.now() - tAblation) / 1000;
  }

  const elapsedSec = (performance.now() - t0) / 1000;
  const cpuSec = totalCpuMs / 1000;
  const util = elapsedSec > 0 ? cpuSec / (elapsedSec * poolSize) : 0;

  console.log(
    `\nphases: coarse=${phaseWall.coarse.toFixed(0)}s discard=${phaseDiscard.coarse}` +
      ` | climb=${phaseWall.climb.toFixed(0)}s discard=${phaseDiscard.climb}` +
      ` | confirm=${phaseWall.confirm.toFixed(0)}s discard=${phaseDiscard.confirm}` +
      ` | ablation=${phaseWall.ablation.toFixed(0)}s discard=${phaseDiscard.ablation}`,
  );
  console.log(
    `evals=${totalEvals} wall=${elapsedSec.toFixed(0)}s cpu=${cpuSec.toFixed(0)}s ` +
      `utilização=${util.toFixed(2)} (${(util * 100).toFixed(0)}% de ${poolSize} workers)`,
  );

  const payload = {
    winner,
    confirmed,
    ablation,
    gatePass,
    gates: { gateVsV2, gateVsV1, gateSelf },
    elapsedSec,
    timing: {
      phases: phaseWall,
      discard: phaseDiscard,
      evals: totalEvals,
      cpuSec,
      poolSize,
      utilization: util,
    },
    config: {
      coarseN,
      coarseGames,
      climbTop,
      confirmTop,
      confirmGames,
      sweepSeed,
      poolSize,
      TRAIN_SEED,
      TEST_SEED,
      V2_VS_V1_BASELINE,
    },
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outPath} in ${elapsedSec.toFixed(0)}s`);
  if (!gatePass) process.exitCode = 2;
}

void main();
