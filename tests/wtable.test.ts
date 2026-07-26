/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { W_TABLE, matchWinProb } from "../packages/bots/src/wtable.js";

describe("W_TABLE (E1)", () => {
  it("has shape 13×13×2", () => {
    expect(W_TABLE).toHaveLength(13);
    expect(W_TABLE[0]).toHaveLength(13);
    expect(W_TABLE[0]![0]).toHaveLength(2);
  });

  it("W(a,a,d) ≈ 0.5 ± 0.04 (dealer bias)", () => {
    for (let a = 0; a <= 11; a++) {
      for (let d = 0; d <= 1; d++) {
        expect(Math.abs(W_TABLE[a]![a]![d]! - 0.5)).toBeLessThanOrEqual(0.04);
      }
    }
  });

  it("W(11,0) > 0.95 and W(0,11) < 0.05", () => {
    for (const d of [0, 1]) {
      expect(W_TABLE[11]![0]![d]!).toBeGreaterThan(0.95);
      expect(W_TABLE[0]![11]![d]!).toBeLessThan(0.05);
    }
  });

  it("monotonic in a (non-decreasing) and b (non-increasing)", () => {
    const tol = 0.03;
    for (let d = 0; d <= 1; d++) {
      for (let b = 0; b <= 11; b++) {
        for (let a = 0; a < 11; a++) {
          expect(W_TABLE[a + 1]![b]![d]! + tol).toBeGreaterThanOrEqual(
            W_TABLE[a]![b]![d]!,
          );
        }
      }
      for (let a = 0; a <= 11; a++) {
        for (let b = 0; b < 11; b++) {
          expect(W_TABLE[a]![b + 1]![d]! - tol).toBeLessThanOrEqual(
            W_TABLE[a]![b]![d]!,
          );
        }
      }
    }
  });

  it("dealer symmetry W(a,b,0)+W(b,a,1) ≈ 1", () => {
    for (let a = 0; a <= 11; a++) {
      for (let b = 0; b <= 11; b++) {
        const s = W_TABLE[a]![b]![0]! + W_TABLE[b]![a]![1]!;
        expect(Math.abs(s - 1)).toBeLessThan(0.061);
      }
    }
  });

  it("matchWinProb flips with team", () => {
    const w0 = matchWinProb([7, 4], 0, 0);
    const w1 = matchWinProb([7, 4], 1, 0);
    expect(w0 + w1).toBeCloseTo(1, 9);
  });
});
