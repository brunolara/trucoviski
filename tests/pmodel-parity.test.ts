/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { P_FEATURE_NAMES } from "../packages/bots/src/features.js";
import {
  winProbability,
  hasPModel,
  loadPModel,
} from "../packages/bots/src/pmodel.js";
import type { PModelWeights } from "../packages/bots/src/pmodel.js";

describe("pmodel parity Python↔TS (E2.3)", () => {
  it("has trained model loaded", () => {
    expect(hasPModel()).toBe(true);
  });

  it("|p_ts − p_py| < 1e-9 on 1000 holdout rows", () => {
    const raw = readFileSync("tests/fixtures/parity_holdout.csv", "utf8")
      .trim()
      .split("\n");
    const header = raw[0]!.split(",");
    const pIdx = header.indexOf("p_py");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    const featIdx = P_FEATURE_NAMES.map((n) => header.indexOf(n));
    expect(featIdx.every((i) => i >= 0)).toBe(true);

    let maxErr = 0;
    for (let r = 1; r < raw.length; r++) {
      const cols = raw[r]!.split(",");
      const feats = featIdx.map((i) => Number(cols[i]));
      const pPy = Number(cols[pIdx]);
      const pTs = winProbability(feats);
      maxErr = Math.max(maxErr, Math.abs(pTs - pPy));
    }
    expect(maxErr).toBeLessThan(1e-9);
  });

  it("loadPModel accepts matching feature count", () => {
    const stub: PModelWeights = {
      trained: true,
      w: Array.from({ length: P_FEATURE_NAMES.length }, () => 0),
      b: 0,
      t: 1,
      features: [...P_FEATURE_NAMES],
    };
    loadPModel(stub);
    expect(winProbability(Array(P_FEATURE_NAMES.length).fill(0))).toBeCloseTo(
      0.5,
      9,
    );
    // restaura pesos reais
    const real = JSON.parse(
      readFileSync("packages/bots/src/pmodel.json", "utf8"),
    ) as PModelWeights;
    loadPModel(real);
  });
});
