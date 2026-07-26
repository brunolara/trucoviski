/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* p' = P(vencer a mão | adversário aceitou o aumento). Mesmas features que p. */

import { P_FEATURE_NAMES } from "./features.js";
import raw from "./pprime.json" with { type: "json" };

export interface PPrimeWeights {
  readonly w: readonly number[];
  readonly b: number;
  readonly t?: number;
  readonly features: readonly string[];
  readonly trained?: boolean;
}

let model: PPrimeWeights | null = null;

function accept(data: PPrimeWeights): PPrimeWeights | null {
  if (data.trained === false) return null;
  if (!Array.isArray(data.w) || data.w.length !== P_FEATURE_NAMES.length) {
    return null;
  }
  return data;
}

model = accept(raw as PPrimeWeights);

export function hasPPrimeModel(): boolean {
  return model !== null;
}

export function winProbabilityGivenCall(f: readonly number[]): number {
  if (!model) {
    throw new Error("pprime.json não treinado — rode scripts/train_p.py");
  }
  if (f.length !== model.w.length) {
    throw new Error(
      `features length ${f.length} != model.w length ${model.w.length}`,
    );
  }
  let z = model.b;
  for (let i = 0; i < f.length; i++) z += model.w[i]! * f[i]!;
  const t = model.t ?? 1;
  return 1 / (1 + Math.exp(-z / t));
}

export function loadPPrimeModel(m: PPrimeWeights): void {
  model = accept(m);
}
