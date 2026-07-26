#!/usr/bin/env node
/* E5 — portões da Missão com useEvTruco (não altera V3_FEATURES em produção). */
import { V3_FEATURES } from "../packages/bots/src/index.js";
import { evaluate } from "./sweep-eval.mts";

const TEST_SEED = 1_000_003;
const games = parseInt(process.argv[2] ?? "20000", 10);
const feats = { ...V3_FEATURES, useEvTruco: true };

console.error(`E5 gate N=${games} seed-block test, useEvTruco=true`);
const t0 = performance.now();
const r = evaluate(feats, games, TEST_SEED);
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
const gateVsV2 = r.wrVsV2 >= 0.535;
const gateVsV1 = r.wrVsV1 >= 0.552;
const gateSelf = r.selfPlayBigRate < 0.317;
const out = {
  elapsed_s: elapsed,
  wrVsV2: r.wrVsV2,
  wrVsV1: r.wrVsV1,
  selfPlayBigRate: r.selfPlayBigRate,
  selfPlay12Rate: r.selfPlay12Rate,
  discarded: r.discarded,
  gateVsV2,
  gateVsV1,
  gateSelf,
  PASS: gateVsV2 && gateVsV1 && gateSelf,
};
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.PASS ? 0 : 1;
