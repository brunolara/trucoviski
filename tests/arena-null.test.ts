import { describe, expect, it } from "vitest";
import { runArena, createPRNG, ci95FromRates } from "@trucoviski/engine";
import {
  decideHeuristicV2Action,
  DEFAULT_FEATURES,
} from "../packages/bots/src/heuristic2.js";
import { runLeague } from "../scripts/league.mts";

describe("Arena F0 instrumentation", () => {
  it("v2 vs v2 mirrored stays at 50% within 95% paired CI (null test)", () => {
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

    const ci = result.winRateTeam0CI95;
    expect(ci.n).toBe(2000);
    expect(ci.lo).toBeLessThanOrEqual(0.5);
    expect(ci.hi).toBeGreaterThanOrEqual(0.5);
  }, 30_000);

  it("diagnostics track closing hand values and per-policy truco", () => {
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
    expect(result.diagnostics.policy0PointsFromRun).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.policy1PointsFromRun).toBeGreaterThanOrEqual(0);
    expect(
      result.diagnostics.policy0PointsFromRun +
        result.diagnostics.policy1PointsFromRun,
    ).toBeGreaterThan(0);
    const accept0 = Object.values(
      result.diagnostics.policy0TrucoAcceptByLevel,
    ).reduce((s, n) => s + n, 0);
    const accept1 = Object.values(
      result.diagnostics.policy1TrucoAcceptByLevel,
    ).reduce((s, n) => s + n, 0);
    expect(accept0 + accept1).toBeGreaterThan(0);
  });

  it("ci95FromRates uses n = number of rates, not 2n", () => {
    const ci = ci95FromRates([0.5, 0.5, 1, 0]);
    expect(ci.n).toBe(4);
    expect(ci.lo).toBeLessThan(0.5);
    expect(ci.hi).toBeGreaterThan(0.5);
  });
});

describe("liga (E1 smoke)", () => {
  it("matriz 3 políticas × 1 bloco fecha e reporta pior confronto", () => {
    const result = runLeague({
      games: 20,
      blocks: ["train"],
      policies: ["heuristic-v1", "heuristic-v2", "heuristic-v3"],
    });
    expect(result.cells).toHaveLength(3);
    expect(result.meanByPolicy["heuristic-v3"]).toBeGreaterThan(0);
    expect(result.worstByPolicy["heuristic-v3"]).toBeDefined();
    expect(result.cells.every((c) => c.n === 20)).toBe(true);
  }, 30_000);

  it("recusa holdout sem --unlock-holdout", () => {
    expect(() => runLeague({ games: 2, blocks: ["holdout"] })).toThrow(
      /holdout/,
    );
  });

  it("recusa holdout-2 sem --unlock-holdout", () => {
    expect(() => runLeague({ games: 2, blocks: ["holdout-2"] })).toThrow(
      /holdout/,
    );
  });
});
