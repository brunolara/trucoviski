/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  P_FEATURE_NAMES,
  Q_FEATURE_NAMES,
} from "../packages/bots/src/features.js";
import {
  foldProbability,
  hasQModel,
  loadQModel,
} from "../packages/bots/src/qmodel.js";
import {
  winProbabilityGivenCall,
  hasPPrimeModel,
  loadPPrimeModel,
} from "../packages/bots/src/pprime.js";
import type { QModelWeights } from "../packages/bots/src/qmodel.js";
import type { PPrimeWeights } from "../packages/bots/src/pprime.js";

function parityCheck(
  path: string,
  featureNames: readonly string[],
  predict: (f: number[]) => number,
): number {
  const raw = readFileSync(path, "utf8").trim().split("\n");
  const header = raw[0]!.split(",");
  const pIdx = header.indexOf("p_py");
  expect(pIdx).toBeGreaterThanOrEqual(0);
  const featIdx = featureNames.map((n) => header.indexOf(n));
  expect(featIdx.every((i) => i >= 0)).toBe(true);

  let maxErr = 0;
  for (let r = 1; r < raw.length; r++) {
    const cols = raw[r]!.split(",");
    const feats = featIdx.map((i) => Number(cols[i]));
    const pPy = Number(cols[pIdx]);
    maxErr = Math.max(maxErr, Math.abs(predict(feats) - pPy));
  }
  return maxErr;
}

describe("qmodel parity Python↔TS (E5)", () => {
  it("has trained model loaded", () => {
    expect(hasQModel()).toBe(true);
  });

  it("|q_ts − q_py| < 1e-9 on holdout rows", () => {
    const maxErr = parityCheck(
      "tests/fixtures/parity_q_holdout.csv",
      Q_FEATURE_NAMES,
      foldProbability,
    );
    expect(maxErr).toBeLessThan(1e-9);
  });

  it("loadQModel accepts matching feature count", () => {
    const stub: QModelWeights = {
      trained: true,
      w: Array.from({ length: Q_FEATURE_NAMES.length }, () => 0),
      b: 0,
      t: 1,
      features: [...Q_FEATURE_NAMES],
    };
    loadQModel(stub);
    expect(foldProbability(Array(Q_FEATURE_NAMES.length).fill(0))).toBeCloseTo(
      0.5,
      9,
    );
    const real = JSON.parse(
      readFileSync("packages/bots/src/qmodel.json", "utf8"),
    ) as QModelWeights;
    loadQModel(real);
  });
});

describe("pprime parity Python↔TS (E5)", () => {
  it("has trained model loaded", () => {
    expect(hasPPrimeModel()).toBe(true);
  });

  it("|p'_ts − p'_py| < 1e-9 on holdout rows", () => {
    const maxErr = parityCheck(
      "tests/fixtures/parity_pprime_holdout.csv",
      P_FEATURE_NAMES,
      winProbabilityGivenCall,
    );
    expect(maxErr).toBeLessThan(1e-9);
  });

  it("loadPPrimeModel accepts matching feature count", () => {
    const stub: PPrimeWeights = {
      trained: true,
      w: Array.from({ length: P_FEATURE_NAMES.length }, () => 0),
      b: 0,
      t: 1,
      features: [...P_FEATURE_NAMES],
    };
    loadPPrimeModel(stub);
    expect(
      winProbabilityGivenCall(Array(P_FEATURE_NAMES.length).fill(0)),
    ).toBeCloseTo(0.5, 9);
    const real = JSON.parse(
      readFileSync("packages/bots/src/pprime.json", "utf8"),
    ) as PPrimeWeights;
    loadPPrimeModel(real);
  });
});
