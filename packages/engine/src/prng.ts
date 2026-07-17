/* ------------------------------------------------------------------ */
/*  PRNG determinístico – mulberry32 + Fisher-Yates                    */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

/** Versão do PRNG para metadados de replay. */
export const PRNG_VERSION = "mulberry32-1.0.0";

/**
 * Gerador pseudoaleatório seedável e determinístico (mulberry32).
 * Sem I/O, puro TypeScript.
 */
export interface PRNG {
  /** Número no intervalo [0, 1). */
  next(): number;
  /** Inteiro no intervalo [0, max). */
  nextInt(max: number): number;
  /** Embaralha array in-place com Fisher-Yates. */
  shuffle<T>(arr: T[]): T[];
}

export function createPRNG(seed: number): PRNG {
  let s = seed | 0;

  function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(max: number): number {
    return Math.floor(next() * max);
  }

  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  return { next, nextInt, shuffle };
}
