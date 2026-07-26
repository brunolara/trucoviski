/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* Inferência do modelo q = P(adversário corre | eu aumento). */

import { Q_FEATURE_NAMES } from "./features.js";
import raw from "./qmodel.json" with { type: "json" };

export interface QModelWeights {
  readonly w: readonly number[];
  readonly b: number;
  readonly t?: number;
  readonly features: readonly string[];
  readonly trained?: boolean;
}

let model: QModelWeights | null = null;

function accept(data: QModelWeights): QModelWeights | null {
  if (data.trained === false) return null;
  if (!Array.isArray(data.w) || data.w.length !== Q_FEATURE_NAMES.length) {
    return null;
  }
  return data;
}

model = accept(raw as QModelWeights);

export function hasQModel(): boolean {
  return model !== null;
}

export function foldProbability(f: readonly number[]): number {
  if (!model) {
    throw new Error("qmodel.json não treinado — rode scripts/train_p.py");
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

export function loadQModel(m: QModelWeights): void {
  model = accept(m);
}
