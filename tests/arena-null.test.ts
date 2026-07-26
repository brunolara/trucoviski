import { describe, it, expect } from "vitest";
import { runArena, createPRNG } from "@trucoviski/engine";
import {
  decideHeuristicV2Action,
  DEFAULT_FEATURES,
} from "../packages/bots/src/heuristic2.js";

describe("Arena F0 instrumentation", () => {
  it("v2 vs v2 mirrored stays at 50% within 95% CI (null test)", () => {
    // N=2000 seeds × 2 = 4000 matches; SE ≈ 0.79pp; half-width 95% ≈ 1.55pp
    const seed = 42;
    const rngA = createPRNG(seed + 1);
    const rngB = createPRNG(seed + 2);
    const result = runArena({
      games: 2000,
      seed,
      mirrored: true,
      policyTeam0: (v) =>
        decideHeuristicV2Action(v, () => rngA.next(), DEFAULT_FEATURES),
      policyTeam1: (v) =>
        decideHeuristicV2Action(v, () => rngB.next(), DEFAULT_FEATURES),
    });

    expect(result.errors).toEqual([]);
    expect(result.completed).toBe(4000);
    expect(result.mirrored).toBe(true);
    expect(result.gamesPerSecond).toBeGreaterThan(0);

    const n = result.completed;
    const p = result.winRateTeam0;
    const se = Math.sqrt((p * (1 - p)) / n);
    const z = 1.96;
    const lo = p - z * se;
    const hi = p + z * se;
    expect(lo).toBeLessThanOrEqual(0.5);
    expect(hi).toBeGreaterThanOrEqual(0.5);
  }, 30_000);

  it("diagnostics track closing hand values and truco actions", () => {
    const seed = 99;
    const rngA = createPRNG(seed + 1);
    const rngB = createPRNG(seed + 2);
    const result = runArena({
      games: 200,
      seed,
      mirrored: true,
      policyTeam0: (v) =>
        decideHeuristicV2Action(v, () => rngA.next(), DEFAULT_FEATURES),
      policyTeam1: (v) =>
        decideHeuristicV2Action(v, () => rngB.next(), DEFAULT_FEATURES),
    });
    expect(result.errors).toEqual([]);
    const values = Object.keys(result.diagnostics.closingHandValues);
    expect(values.length).toBeGreaterThan(0);
    expect(result.diagnostics.pointsFromRun).toBeGreaterThanOrEqual(0);
  });
});
