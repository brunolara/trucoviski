#!/usr/bin/env node
/* C2 — varredura de evSharpness (respond-EV isolado, raise EV off). */
import { V3_FEATURES } from "../packages/bots/src/index.js";
import { evaluate } from "./sweep-eval.mts";

const TEST_SEED = 1_000_003;
const games = parseInt(process.argv[2] ?? "20000", 10);
const sharpnesses = (process.argv[3] ?? "30,100,300,1000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10));

console.error(
  `C2 evSharpness sweep N=${games} seed-block test ` +
    `useEvTruco=true useEvRaise=false sharp=${sharpnesses.join(",")}`,
);

const results = [];
for (const evSharpness of sharpnesses) {
  const feats = {
    ...V3_FEATURES,
    useEvTruco: true,
    useEvRaise: false,
    evSharpness,
  };
  const t0 = performance.now();
  const r = evaluate(feats, games, TEST_SEED);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const row = {
    evSharpness,
    elapsed_s: elapsed,
    wrVsV2: r.wrVsV2,
    wrVsV1: r.wrVsV1,
    selfPlayBigRate: r.selfPlayBigRate,
    selfPlay12Rate: r.selfPlay12Rate,
    discarded: r.discarded,
  };
  results.push(row);
  console.error(
    `  sharp=${evSharpness}: vsV2=${(r.wrVsV2 * 100).toFixed(2)}% ` +
      `vsV1=${(r.wrVsV1 * 100).toFixed(2)}% ` +
      `self≥9=${(r.selfPlayBigRate * 100).toFixed(1)}% ` +
      `self@12=${(r.selfPlay12Rate * 100).toFixed(1)}% (${elapsed}s)`,
  );
}

const selfRates = results.map((r) => r.selfPlayBigRate);
let mono = true;
for (let i = 1; i < selfRates.length; i++) {
  const a = selfRates[i - 1];
  const b = selfRates[i];
  if (a === undefined || b === undefined) continue;
  if (b > a + 1e-9) {
    mono = false;
    break;
  }
}
const out = {
  results,
  selfFallsMonotonically: mono,
  cause2: mono && selfRates[0]! - selfRates[selfRates.length - 1]! > 0.02,
};
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.cause2 ? 0 : 1;
