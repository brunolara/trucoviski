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

const TRAIN_SEED = 42;
const TEST_SEED = 1_000_003;

const WORKER = fileURLToPath(new URL("./sweep-worker.mts", import.meta.url));
const POOL_SIZE = Math.max(1, Math.min(cpus().length - 2, 10));

type KnobKey =
  | "responseBaseOffset"
  | "proposeBaseOffset"
  | "elevenPairFloor"
  | "positionBeatsBonus"
  | "positionInfoBonus"
  | "raiseGuardMaxLevel"
  | "distDangerWeight"
  | "distFinishWeight"
  | "runCostWeight"
  | "softTopAliveBonus"
  | "softWonFirstBonus";

const KNOB_RANGES: Record<KnobKey, { min: number; max: number; step: number }> =
  {
    responseBaseOffset: { min: -1, max: 5, step: 0.5 },
    proposeBaseOffset: { min: -1, max: 5, step: 0.5 },
    elevenPairFloor: { min: 6, max: 10, step: 1 },
    // F5.2: knobs assinados — arena escolhe o sinal
    positionBeatsBonus: { min: -0.15, max: 0.15, step: 0.03 },
    positionInfoBonus: { min: -0.15, max: 0.15, step: 0.03 },
    raiseGuardMaxLevel: { min: 6, max: 12, step: 3 },
    distDangerWeight: { min: 0.0, max: 0.2, step: 0.02 },
    distFinishWeight: { min: 0.0, max: 0.2, step: 0.02 },
    runCostWeight: { min: 0.0, max: 0.25, step: 0.025 },
    softTopAliveBonus: { min: 0.1, max: 0.45, step: 0.05 },
    softWonFirstBonus: { min: 0.1, max: 0.4, step: 0.05 },
  };

const FLAG_KEYS = [
  "elevenNeedsPair",
  "positionAware",
  "raiseGuard",
  "distanceToTwelve",
  "softOverrides",
  "topTwoStrength",
] as const;

/**
 * Avalia `jobs` em paralelo e devolve os resultados NA MESMA ORDEM da entrada.
 * A ordem importa: o sweep desempata por posição e precisa ser determinístico.
 */
function evaluateAll(
  jobs: { features: HeuristicV2Features; games: number; seed: number }[],
): Promise<CandidateResult[]> {
  if (jobs.length === 0) return Promise.resolve([]);
  // Um job só: evita fork overhead (ex.: vizinho único no hill climb).
  if (jobs.length === 1) {
    const j = jobs[0]!;
    return Promise.resolve([evaluate(j.features, j.games, j.seed)]);
  }
  return new Promise((resolve, reject) => {
    const results: CandidateResult[] = new Array(jobs.length);
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
      // Garante que nenhum slot ficou vazio (mensagem perdida)
      for (let i = 0; i < results.length; i++) {
        if (results[i] == null) {
          fail(new Error(`evaluateAll: missing result for job ${i}`));
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

    for (let i = 0; i < Math.min(POOL_SIZE, jobs.length); i++) {
      const w = fork(WORKER, [], { execArgv: ["--import", "tsx"] });
      workers.push(w);
      w.on(
        "message",
        (msg: {
          type: string;
          id?: number;
          result?: CandidateResult;
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
            fail(new Error(`worker sent unexpected message: ${JSON.stringify(msg)}`));
            return;
          }
          results[msg.id] = msg.result;
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

function clampRound(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  return Number((min + steps * step).toFixed(4));
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

function neighbor(
  base: HeuristicV2Features,
  key: KnobKey,
  dir: -1 | 1,
): HeuristicV2Features | null {
  const { min, max, step } = KNOB_RANGES[key];
  const next = clampRound((base[key] as number) + dir * step, min, max, step);
  if (next === base[key]) return null;
  return { ...base, [key]: next };
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function flagsSummary(f: HeuristicV2Features): string {
  return FLAG_KEYS.map((k) => (f[k] ? k[0] : ".")).join("");
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const coarseN = parseInt(args.coarse ?? "200", 10);
  const coarseGames = parseInt(args["coarse-games"] ?? "2000", 10);
  const climbTop = parseInt(args["climb-top"] ?? "10", 10);
  const confirmTop = parseInt(args["confirm-top"] ?? "5", 10);
  const confirmGames = parseInt(args["confirm-games"] ?? "20000", 10);
  const sweepSeed = parseInt(args.seed ?? "7", 10);
  const skipAblation = args["skip-ablation"] === "true";
  const outPath = args.out ?? "docs/v3-sweep-result.json";

  const sweepRng = createPRNG(sweepSeed);
  const rng = () => sweepRng.next();

  console.log(
    `F6 sweep: coarse=${coarseN}×${coarseGames}, climb top ${climbTop}, confirm top ${confirmTop}×${confirmGames} (pool=${POOL_SIZE})`,
  );
  console.log(
    `  constraint: vsV1 ≥ ${formatPct(V2_VS_V1_BASELINE)} − tol; fitness = wrVsV2 − selfPlayBig×0.15`,
  );

  const t0 = performance.now();

  const candidates = Array.from({ length: coarseN }, () => ({
    features: randomFeatures(rng),
    games: coarseGames,
    seed: TRAIN_SEED,
  }));
  const coarse = await evaluateAll(candidates);
  const discardedCount = coarse.filter((c) => c.discarded).length;
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
        ` discard=${discardedCount} flagsSample=${flagSample} ` +
        `(${((performance.now() - t0) / 1000).toFixed(0)}s)`,
    );
  }

  coarse.sort((a, b) => b.fitness - a.fitness);
  const seeds = coarse.filter((c) => !c.discarded).slice(0, climbTop);
  console.log(
    `\nHill climb on top ${seeds.length}/${climbTop} viable (≤40 evals each)…`,
  );

  const climbed: CandidateResult[] = [];
  for (let i = 0; i < seeds.length; i++) {
    let current = seeds[i]!;
    let evals = 0;
    const maxEvals = 40;

    for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
      if (evals >= maxEvals) break;
      const neighbours = [
        neighbor(current.features, key, -1),
        neighbor(current.features, key, 1),
      ].filter((f): f is HeuristicV2Features => f !== null);
      if (neighbours.length === 0) continue;
      // Cap: não ultrapassar maxEvals
      const batch = neighbours.slice(0, maxEvals - evals);
      evals += batch.length;
      const evs = await evaluateAll(
        batch.map((f) => ({
          features: f,
          games: coarseGames,
          seed: TRAIN_SEED,
        })),
      );
      for (const ev of evs)
        if (!ev.discarded && ev.fitness > current.fitness + 1e-6) current = ev;
    }

    for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
      if (evals >= maxEvals) break;
      const { min, max, step } = KNOB_RANGES[key];
      if (step >= 1) continue;
      const halfNeighbours: HeuristicV2Features[] = [];
      for (const dir of [-1, 1] as const) {
        const half = clampRound(
          (current.features[key] as number) + dir * step * 0.5,
          min,
          max,
          step * 0.5,
        );
        if (half === current.features[key]) continue;
        halfNeighbours.push({ ...current.features, [key]: half });
      }
      if (halfNeighbours.length === 0) continue;
      const batch = halfNeighbours.slice(0, maxEvals - evals);
      evals += batch.length;
      const evs = await evaluateAll(
        batch.map((f) => ({
          features: f,
          games: coarseGames,
          seed: TRAIN_SEED,
        })),
      );
      for (const ev of evs)
        if (!ev.discarded && ev.fitness > current.fitness + 1e-6) current = ev;
    }

    climbed.push(current);
    console.log(
      `  climb ${i + 1}/${seeds.length}: fitness=${current.fitness.toFixed(4)} ` +
        `vsV2=${formatPct(current.wrVsV2)} vsV1=${formatPct(current.wrVsV1)} ` +
        `self≥9=${(current.selfPlayBigRate * 100).toFixed(1)}% evals=${evals}`,
    );
  }

  climbed.sort((a, b) => b.fitness - a.fitness);
  const toConfirm = climbed.filter((c) => !c.discarded).slice(0, confirmTop);
  console.log(
    `\nConfirm top ${toConfirm.length} on TEST seeds @ ${confirmGames}…`,
  );

  const confirmed = await evaluateAll(
    toConfirm.map((c) => ({
      features: c.features,
      games: confirmGames,
      seed: TEST_SEED,
    })),
  );
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

  // Portão F6 (Missão): vs v2 ≥ 53.5%, vs v1 ≥ 55.2% (não regredir do v3), self ≥9 < 31.7%.
  // A restrição dura do fitness (V2_VS_V1_BASELINE) é mais frouxa — só evita piorar vs o v2.
  const GATE_VS_V2 = 0.535;
  const GATE_VS_V1 = 0.552; // Missão: não regredir do 55.93% medido
  const GATE_SELF_BIG = 0.317;
  const gateVsV2 = winner.wrVsV2 >= GATE_VS_V2;
  const gateVsV1 = winner.wrVsV1 >= GATE_VS_V1;
  const gateSelf = winner.selfPlayBigRate < GATE_SELF_BIG;
  const gatePass = gateVsV2 && gateVsV1 && gateSelf && !winner.discarded;

  console.log(
    `\nWinner: fitness=${winner.fitness.toFixed(4)} vsV2=${formatPct(winner.wrVsV2)} vsV1=${formatPct(winner.wrVsV1)} ` +
      `self≥9=${(winner.selfPlayBigRate * 100).toFixed(1)}% self12=${(winner.selfPlay12Rate * 100).toFixed(1)}%`,
  );
  console.log(
    `Gate: vsV2≥53.5% ${gateVsV2 ? "OK" : "FAIL"} | vsV1≥55.2% ${gateVsV1 ? "OK" : "FAIL"} | self≥9<31.7% ${gateSelf ? "OK" : "FAIL"} → ${gatePass ? "PASS" : "FAIL"}`,
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
  if (!skipAblation && !winner.discarded) {
    console.log(`\nAblation @ ${confirmGames} test…`);
    const baseline = winner.fitness;
    const ablFlags = FLAG_KEYS.filter((flag) => winner.features[flag]);
    for (const flag of FLAG_KEYS) {
      if (!winner.features[flag]) {
        console.log(`  ${flag}=already off — skip`);
      }
    }
    if (ablFlags.length > 0) {
      const ablationResults = await evaluateAll(
        ablFlags.map((flag) => ({
          features: { ...winner.features, [flag]: false },
          games: confirmGames,
          seed: TEST_SEED,
        })),
      );
      for (let i = 0; i < ablFlags.length; i++) {
        const flag = ablFlags[i]!;
        const ev = ablationResults[i]!;
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
  }

  const payload = {
    winner,
    confirmed,
    ablation,
    gatePass,
    gates: { gateVsV2, gateVsV1, gateSelf },
    elapsedSec: (performance.now() - t0) / 1000,
    config: {
      coarseN,
      coarseGames,
      climbTop,
      confirmTop,
      confirmGames,
      sweepSeed,
      TRAIN_SEED,
      TEST_SEED,
      V2_VS_V1_BASELINE,
    },
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outPath} in ${payload.elapsedSec.toFixed(0)}s`);
  if (!gatePass) process.exitCode = 2;
}

void main();
