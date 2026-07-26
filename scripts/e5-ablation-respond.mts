#!/usr/bin/env node
/* Ablation F: EV respond on, raise completely off (EV + classic + manilha).
 *
 * useEvRaise:false sozinho deixa propose clássico — EV quase não corre →
 * classic sobe a escada e self≥9 fica ~88%. Esta variante mata todo raise
 * para isolar o respond (predição F: self≥9 ~24%). */
import { V3_FEATURES } from "../packages/bots/src/index.js";
import type { HeuristicV2Features } from "../packages/bots/src/heuristic2.js";
import { evaluate } from "./sweep-eval.mts";

const TEST_SEED = 1_000_003;
const games = parseInt(process.argv[2] ?? "20000", 10);

/** raiseGuardMaxLevel 0 + useEvRaise false: bloqueia propose clássico e EV raise.
 *  O early-return myMax≥12 ainda sobe se raiseGuardMaxLevel ≥ próximo nível —
 *  por isso maxLevel=0 também mata esse escape. */
const feats: HeuristicV2Features = {
  ...V3_FEATURES,
  useEvTruco: true,
  useEvRaise: false,
  raiseGuard: true,
  raiseGuardMaxLevel: 0,
};

console.error(
  `Ablation respond-only (no raise) N=${games} seed-block test ` +
    `useEvTruco=true useEvRaise=false raiseGuardMaxLevel=0`,
);
const t0 = performance.now();
const r = evaluate(feats, games, TEST_SEED);
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
const gateVsV2 = r.wrVsV2 >= 0.535;
const gateVsV1 = r.wrVsV1 >= 0.552;
const gateSelf = r.selfPlayBigRate < 0.317;
const out = {
  mode: "respond-only-no-raise",
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
  predSelfOk: r.selfPlayBigRate < 0.35,
  predVsV1Ok: r.wrVsV1 >= 0.52,
};
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.PASS ? 0 : 1;
