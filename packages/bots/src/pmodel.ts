/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* Inferência do modelo p — pesos em pmodel.json (treino offline). */

import { P_FEATURE_NAMES } from "./features.js";
import raw from "./pmodel.json" with { type: "json" };

export interface PModelWeights {
  readonly w: readonly number[];
  readonly b: number;
  /** Temperatura da sigmoide (calibração). Default 1. */
  readonly t?: number;
  readonly features: readonly string[];
  readonly trained?: boolean;
}

let model: PModelWeights | null = null;

function accept(data: PModelWeights): PModelWeights | null {
  if (data.trained === false) return null;
  if (!Array.isArray(data.w) || data.w.length !== P_FEATURE_NAMES.length) {
    return null;
  }
  return data;
}

model = accept(raw as PModelWeights);

export function hasPModel(): boolean {
  return model !== null;
}

export function winProbability(f: readonly number[]): number {
  if (!model) {
    throw new Error("pmodel.json não treinado — rode scripts/train_p.py");
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

/** Injeta pesos (testes / após treino no mesmo processo). */
export function loadPModel(m: PModelWeights): void {
  model = accept(m);
}
