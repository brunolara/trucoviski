#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Varredura e recalibração de parâmetros de truco (Etapa E5)        */
/*  Fitness = média da liga; estilo como restrição; sem winner's curse*/
/* ------------------------------------------------------------------ */

import { fork, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createPRNG } from "../packages/engine/src/index.js";
import { V3_FEATURES } from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";
import { evaluateE5 } from "./sweep-e5-eval.mts";
import type { CandidateResultE5 } from "./sweep-e5-eval.mts";
import { SEED_BLOCKS } from "./bot-policies.mts";

const TRAIN_SEED = SEED_BLOCKS.train;
const CONFIRM_SEED_A = SEED_BLOCKS["train-a"];
const CONFIRM_SEED_B = SEED_BLOCKS["train-b"];

const WORKER = fileURLToPath(new URL("./sweep-e5-worker.mts", import.meta.url));
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
    responseBaseOffset: { min: 1.5, max: 4.5, step: 0.5 },
    proposeBaseOffset: { min: 1.5, max: 4.0, step: 0.5 },
    elevenPairFloor: { min: 7, max: 10, step: 1 },
    positionBeatsBonus: { min: 0.02, max: 0.16, step: 0.02 },
    positionInfoBonus: { min: 0.02, max: 0.12, step: 0.02 },
    raiseGuardMaxLevel: { min: 6, max: 12, step: 3 },
    distDangerWeight: { min: 0.04, max: 0.18, step: 0.02 },
    distFinishWeight: { min: 0.04, max: 0.18, step: 0.02 },
    runCostWeight: { min: 0.04, max: 0.18, step: 0.02 },
    softTopAliveBonus: { min: 0.15, max: 0.45, step: 0.05 },
    softWonFirstBonus: { min: 0.15, max: 0.45, step: 0.05 },
  };

const FLAG_KEYS = [
  "elevenNeedsPair",
  "positionAware",
  "raiseGuard",
  "distanceToTwelve",
  "softOverrides",
  "topTwoStrength",
  "twelveScoreBalance",
] as const;

function evaluateAll(
  jobs: { features: HeuristicV2Features; games: number; seed: number }[],
): Promise<CandidateResultE5[]> {
  if (jobs.length === 0) return Promise.resolve([]);
  if (jobs.length === 1) {
    const j = jobs[0]!;
    return Promise.resolve([evaluateE5(j.features, j.games, j.seed)]);
  }
  return new Promise((resolve, reject) => {
    const results: CandidateResultE5[] = new Array(jobs.length);
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
          result?: CandidateResultE5;
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

function randomTrucoFeatures(rng: () => number): HeuristicV2Features {
  const f: HeuristicV2Features = { ...V3_FEATURES };
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

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const coarseN = parseInt(args.coarse ?? "80", 10);
  const coarseGames = parseInt(args["coarse-games"] ?? "1500", 10);
  const climbTop = parseInt(args["climb-top"] ?? "6", 10);
  const confirmGames = parseInt(args["confirm-games"] ?? "4000", 10);
  const sweepSeed = parseInt(args.seed ?? "42", 10);
  const outPath = args.out ?? "docs/e5-sweep-result.json";

  const sweepRng = createPRNG(sweepSeed);
  const rng = () => sweepRng.next();

  console.log(
    `=== E5 Truco Recalibration Sweep ===\n` +
      `coarse=${coarseN}×${coarseGames}, climb top ${climbTop}, confirm top ${climbTop}×${confirmGames} (pool=${POOL_SIZE})\n` +
      `Fitness = Liga média (V1, V2, Agressivo, Conservador); Restrição: self≥9 < 33%, vsV1/V2 ≥ 54%`,
  );

  const t0 = performance.now();

  // Baseline evaluation (current V3_FEATURES)
  const [baselineEval] = await evaluateAll([
    { features: V3_FEATURES, games: coarseGames, seed: TRAIN_SEED },
  ]);
  console.log(
    `Baseline v3 atual: fitness=${baselineEval!.fitness.toFixed(4)} ` +
      `liga_média=${formatPct(baselineEval!.meanLeagueWr)} pior=${formatPct(baselineEval!.worstWr)} ` +
      `vsV2=${formatPct(baselineEval!.wrVsV2)} vsV1=${formatPct(baselineEval!.wrVsV1)} self≥9=${formatPct(baselineEval!.selfPlayBigRate)}`,
  );

  // 1. Coarse search
  const candidates = [
    { features: V3_FEATURES, games: coarseGames, seed: TRAIN_SEED },
    ...Array.from({ length: coarseN - 1 }, () => ({
      features: randomTrucoFeatures(rng),
      games: coarseGames,
      seed: TRAIN_SEED,
    })),
  ];

  const coarse = await evaluateAll(candidates);
  const viable = coarse.filter((c) => !c.discarded);
  const bestCoarse = [...viable].sort((a, b) => b.fitness - a.fitness)[0];

  console.log(
    `\nCoarse concluído: ${viable.length}/${coarseN} viáveis. ` +
      (bestCoarse
        ? `Melhor: fit=${bestCoarse.fitness.toFixed(4)} liga_média=${formatPct(bestCoarse.meanLeagueWr)} vsV2=${formatPct(bestCoarse.wrVsV2)} vsV1=${formatPct(bestCoarse.wrVsV1)} self≥9=${formatPct(bestCoarse.selfPlayBigRate)}`
        : "nenhum viável") +
      ` (${((performance.now() - t0) / 1000).toFixed(0)}s)`,
  );

  // 2. Hill climb
  coarse.sort((a, b) => b.fitness - a.fitness);
  const seeds = coarse.filter((c) => !c.discarded).slice(0, climbTop);
  console.log(`\nHill climbing no top ${seeds.length} viáveis…`);

  const climbed: CandidateResultE5[] = [];
  for (let i = 0; i < seeds.length; i++) {
    let current = seeds[i]!;
    let evals = 0;
    const maxEvals = 30;

    for (const key of Object.keys(KNOB_RANGES) as KnobKey[]) {
      if (evals >= maxEvals) break;
      const neighbours = [
        neighbor(current.features, key, -1),
        neighbor(current.features, key, 1),
      ].filter((f): f is HeuristicV2Features => f !== null);
      if (neighbours.length === 0) continue;

      const batch = neighbours.slice(0, maxEvals - evals);
      evals += batch.length;
      const evs = await evaluateAll(
        batch.map((f) => ({
          features: f,
          games: coarseGames,
          seed: TRAIN_SEED,
        })),
      );
      for (const ev of evs) {
        if (!ev.discarded && ev.fitness > current.fitness + 1e-6) current = ev;
      }
    }

    climbed.push(current);
    console.log(
      `  climb ${i + 1}/${seeds.length}: fit=${current.fitness.toFixed(4)} ` +
        `liga_média=${formatPct(current.meanLeagueWr)} pior=${formatPct(current.worstWr)} ` +
        `vsV2=${formatPct(current.wrVsV2)} vsV1=${formatPct(current.wrVsV1)} self≥9=${formatPct(current.selfPlayBigRate)} evals=${evals}`,
    );
  }

  // 3. Winner's Curse check: Confirm on independent blocks train-a and train-b with 4000 games
  climbed.sort((a, b) => b.fitness - a.fitness);
  const toConfirm = climbed.filter((c) => !c.discarded).slice(0, 4);
  console.log(
    `\n--- Confirmação independente (Anti Winner's Curse) em train-a e train-b (${confirmGames} seeds) ---`,
  );

  interface ConfirmedCandidate {
    candidate: CandidateResultE5;
    trainA: CandidateResultE5;
    trainB: CandidateResultE5;
    confirmedMean: number;
    confirmedWorst: number;
  }

  const confirmedList: ConfirmedCandidate[] = [];
  for (let i = 0; i < toConfirm.length; i++) {
    const c = toConfirm[i]!;
    const [resA, resB] = await evaluateAll([
      { features: c.features, games: confirmGames, seed: CONFIRM_SEED_A },
      { features: c.features, games: confirmGames, seed: CONFIRM_SEED_B },
    ]);

    const confirmedMean = (resA!.meanLeagueWr + resB!.meanLeagueWr) / 2;
    const confirmedWorst = Math.min(resA!.worstWr, resB!.worstWr);

    confirmedList.push({
      candidate: c,
      trainA: resA!,
      trainB: resB!,
      confirmedMean,
      confirmedWorst,
    });

    console.log(
      `  Candidato ${i + 1}: train_fit=${c.fitness.toFixed(4)} → ` +
        `conf_média=${formatPct(confirmedMean)} conf_pior=${formatPct(confirmedWorst)} ` +
        `(train-a: ${formatPct(resA!.meanLeagueWr)}, train-b: ${formatPct(resB!.meanLeagueWr)}) ` +
        `self≥9: a=${formatPct(resA!.selfPlayBigRate)} b=${formatPct(resB!.selfPlayBigRate)}`,
    );
  }

  // Also confirm current baseline on train-a and train-b
  const [baseA, baseB] = await evaluateAll([
    { features: V3_FEATURES, games: confirmGames, seed: CONFIRM_SEED_A },
    { features: V3_FEATURES, games: confirmGames, seed: CONFIRM_SEED_B },
  ]);
  const baseConfMean = (baseA!.meanLeagueWr + baseB!.meanLeagueWr) / 2;
  const baseConfWorst = Math.min(baseA!.worstWr, baseB!.worstWr);

  console.log(
    `\nBaseline v3 confirmado: conf_média=${formatPct(baseConfMean)} conf_pior=${formatPct(baseConfWorst)} ` +
      `(train-a: ${formatPct(baseA!.meanLeagueWr)}, train-b: ${formatPct(baseB!.meanLeagueWr)})`,
  );

  confirmedList.sort((a, b) => b.confirmedMean - a.confirmedMean);
  const winner = confirmedList[0];

  console.log(`\n=== VENCEDOR DO SWEEP E5 ===`);
  if (winner) {
    const deltaMean = (winner.confirmedMean - baseConfMean) * 100;
    const deltaWorst = (winner.confirmedWorst - baseConfWorst) * 100;
    console.log(
      `Melhor preset: conf_média=${formatPct(winner.confirmedMean)} (Δ = ${deltaMean >= 0 ? "+" : ""}${deltaMean.toFixed(2)}pp) ` +
        `conf_pior=${formatPct(winner.confirmedWorst)} (Δ = ${deltaWorst >= 0 ? "+" : ""}${deltaWorst.toFixed(2)}pp)`,
    );
    console.log(`\nFeatures:`);
    console.log(JSON.stringify(winner.candidate.features, null, 2));

    // 4. Ablation study on the winning features
    console.log(
      `\n--- Ablação nos flags de truco (em train-a @ ${confirmGames} seeds) ---`,
    );
    const ablationResults: Array<{
      flag: string;
      delta: number;
      meanWr: number;
    }> = [];

    for (const flag of FLAG_KEYS) {
      if (winner.candidate.features[flag]) {
        const [abl] = await evaluateAll([
          {
            features: { ...winner.candidate.features, [flag]: false },
            games: confirmGames,
            seed: CONFIRM_SEED_A,
          },
        ]);
        const delta = (winner.trainA.meanLeagueWr - abl!.meanLeagueWr) * 100;
        ablationResults.push({ flag, delta, meanWr: abl!.meanLeagueWr });
        console.log(
          `  ${flag}=false: liga_média=${formatPct(abl!.meanLeagueWr)} (Δ = ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp vs flag on)`,
        );
      }
    }

    const payload = {
      winner: winner.candidate.features,
      confirmedMean: winner.confirmedMean,
      confirmedWorst: winner.confirmedWorst,
      baseConfMean,
      baseConfWorst,
      deltaMean,
      deltaWorst,
      ablation: ablationResults,
      elapsedSec: (performance.now() - t0) / 1000,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\nResultados salvos em ${outPath}`);
  }
}

main().catch(console.error);
