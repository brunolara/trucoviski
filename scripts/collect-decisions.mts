#!/usr/bin/env node
/* E2.1 / E4 / E5 — coleta decisões de truco (p) + raise outcomes (q, p').
 *
 * E4: políticas v3 coletam com useEvTruco:true (override), sem flipar
 * V3_FEATURES em produção. Assim q/p/p' veem a distribuição do bot EV.
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { createPRNG, runArena, TEAMS } from "../packages/engine/src/index.js";
import type { Action, PlayerView } from "../packages/engine/src/index.js";
import {
  decideHeuristicAction,
  decideHeuristicV2Action,
  decideHeuristicV3Action,
  DEFAULT_FEATURES,
  V3_FEATURES,
  extractTrucoFeatures,
  extractQFeatures,
  P_FEATURE_NAMES,
  Q_FEATURE_NAMES,
} from "../packages/bots/src/index.js";

const games = parseInt(process.argv[2] ?? "100000", 10);
const seed = parseInt(process.argv[3] ?? "42", 10);
const outDir = process.argv[4] ?? "data";

/** Coleta E4: bot EV (não altera o default de produção). */
const COLLECT_FEATURES = { ...V3_FEATURES, useEvTruco: true };

mkdirSync(outDir, { recursive: true });

type PendingP = { seat: number; features: number[] };
type PendingRaise = {
  seat: number;
  qFeatures: number[];
  pFeatures: number[];
};

const pendingByHand = new Map<string, PendingP[]>();
const openRaiseByHand = new Map<string, PendingRaise>();
const pRows: { features: number[]; label: 0 | 1 }[] = [];
const qRows: { features: number[]; label: 0 | 1 }[] = [];
const pPrimeRows: { features: number[]; label: 0 | 1 }[] = [];
/** Raises aceitos: features aguardando handResult para label de p'. */
const acceptedRaisesByHand = new Map<string, PendingRaise[]>();

function makeV3(botSeed: number) {
  const rng = createPRNG(botSeed);
  return (view: PlayerView): Action | null =>
    decideHeuristicV3Action(view, () => rng.next(), COLLECT_FEATURES);
}

function makeV2(botSeed: number) {
  const rng = createPRNG(botSeed);
  return (view: PlayerView): Action | null =>
    decideHeuristicV2Action(view, () => rng.next(), DEFAULT_FEATURES);
}

function makeV1() {
  return decideHeuristicAction;
}

function collect(row: {
  phase: "decision" | "handResult" | "raise" | "raiseResolved";
  handId: string;
  seat?: number;
  view?: PlayerView;
  winnerTeam?: 0 | 1;
  proposedLevel?: number;
  opponentRan?: boolean;
  opponentAccepted?: boolean;
}) {
  if (row.phase === "decision" && row.view && row.seat !== undefined) {
    const list = pendingByHand.get(row.handId) ?? [];
    list.push({
      seat: row.seat,
      features: extractTrucoFeatures(row.view),
    });
    pendingByHand.set(row.handId, list);
    return;
  }

  if (
    row.phase === "raise" &&
    row.view &&
    row.seat !== undefined &&
    row.proposedLevel !== undefined
  ) {
    openRaiseByHand.set(row.handId, {
      seat: row.seat,
      qFeatures: extractQFeatures(row.view, row.proposedLevel),
      pFeatures: extractTrucoFeatures(row.view),
    });
    return;
  }

  if (row.phase === "raiseResolved" && row.opponentRan !== undefined) {
    const pending = openRaiseByHand.get(row.handId);
    openRaiseByHand.delete(row.handId);
    if (!pending) return;
    qRows.push({
      features: pending.qFeatures,
      label: row.opponentRan ? 1 : 0,
    });
    if (row.opponentAccepted) {
      const list = acceptedRaisesByHand.get(row.handId) ?? [];
      list.push(pending);
      acceptedRaisesByHand.set(row.handId, list);
    }
    return;
  }

  if (row.phase === "handResult" && row.winnerTeam !== undefined) {
    const list = pendingByHand.get(row.handId) ?? [];
    for (const p of list) {
      const team = TEAMS[p.seat as 0 | 1 | 2 | 3] as 0 | 1;
      pRows.push({
        features: p.features,
        label: team === row.winnerTeam ? 1 : 0,
      });
    }
    pendingByHand.delete(row.handId);

    const accepted = acceptedRaisesByHand.get(row.handId) ?? [];
    for (const r of accepted) {
      const team = TEAMS[r.seat as 0 | 1 | 2 | 3] as 0 | 1;
      pPrimeRows.push({
        features: r.pFeatures,
        label: team === row.winnerTeam ? 1 : 0,
      });
    }
    acceptedRaisesByHand.delete(row.handId);
    openRaiseByHand.delete(row.handId);
  }
}

const t0 = performance.now();
const nSelf = Math.floor(games / 2);
const nV2 = Math.floor(games / 4);
const nV1 = games - nSelf - nV2;

for (const [label, n, p0, p1, s] of [
  ["self", nSelf, makeV3(seed + 1), makeV3(seed + 2), seed],
  ["v2", nV2, makeV3(seed + 3), makeV2(seed + 4), seed + 1_000_000],
  ["v1", nV1, makeV3(seed + 5), makeV1(), seed + 2_000_000],
] as const) {
  console.error(`collect ${label}: ${n} games…`);
  runArena({
    games: n,
    seed: s,
    mirrored: false,
    policyTeam0: p0,
    policyTeam1: p1,
    collect,
  });
}

const pMean =
  pRows.reduce((a, r) => a + r.label, 0) / Math.max(1, pRows.length);
const qMean =
  qRows.reduce((a, r) => a + r.label, 0) / Math.max(1, qRows.length);
console.error(
  `p rows=${pRows.length} labelMean=${pMean.toFixed(3)} | ` +
    `q rows=${qRows.length} foldRate=${qMean.toFixed(3)} | ` +
    `p' rows=${pPrimeRows.length} ` +
    `(${((performance.now() - t0) / 1000).toFixed(1)}s)`,
);

function splitWrite(
  prefix: string,
  names: readonly string[],
  data: { features: number[]; label: 0 | 1 }[],
): void {
  // Embaralha antes do split — coleta é self→v2→v1; holdout sequencial enviesa.
  const rng = createPRNG(seed ^ 0x9e3779b9);
  const shuffled = data.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) continue;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  const split = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, split);
  const hold = shuffled.slice(split);
  writeCsv(`${outDir}/${prefix}_train.csv`, names, train);
  writeCsv(`${outDir}/${prefix}_holdout.csv`, names, hold);
  console.error(`wrote ${prefix} train=${train.length} holdout=${hold.length}`);
}

function writeCsv(
  path: string,
  names: readonly string[],
  data: { features: number[]; label: 0 | 1 }[],
): void {
  writeFileSync(path, [...names, "label"].join(",") + "\n");
  const chunk = 50_000;
  for (let i = 0; i < data.length; i += chunk) {
    const slice = data.slice(i, i + chunk);
    appendFileSync(
      path,
      slice
        .map((r) => [...r.features.map((x) => x.toFixed(6)), r.label].join(","))
        .join("\n") + "\n",
    );
  }
}

splitWrite("decisions", P_FEATURE_NAMES, pRows);
splitWrite("q", Q_FEATURE_NAMES, qRows);
splitWrite("pprime", P_FEATURE_NAMES, pPrimeRows);

if (Math.abs(pMean - 0.5) > 0.08) {
  console.error("SANITY WARN: p labelMean longe de 0.5 — cheque assento/time");
  process.exitCode = 1;
}
if (qRows.length < 1000) {
  console.error("SANITY WARN: poucas linhas de q");
  process.exitCode = 1;
}
