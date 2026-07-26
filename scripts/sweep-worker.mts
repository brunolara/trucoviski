#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* Worker do sweep: eval avulsa ou climb chain inteiro. */
import { evaluate } from "./sweep-eval.mts";
import type { CandidateResult } from "./sweep-eval.mts";
import { climbChain } from "./sweep-climb.mts";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

interface EvalTask {
  id: number;
  kind?: "eval";
  features: HeuristicV2Features;
  games: number;
  seed: number;
  vsV2Only?: boolean;
}

interface ClimbTask {
  id: number;
  kind: "climb";
  start: CandidateResult;
  games: number;
  seed: number;
  vsV2Only?: boolean;
}

type Task = EvalTask | ClimbTask;

process.send!({ type: "ready" });

process.on("message", (task: Task) => {
  const t0 = performance.now();
  const vsV2Only = task.vsV2Only === true;
  try {
    if (task.kind === "climb") {
      const { result, evals, discarded } = climbChain(
        task.start,
        task.games,
        task.seed,
        vsV2Only,
      );
      process.send!({
        type: "result",
        id: task.id,
        kind: "climb",
        result,
        evals,
        discarded,
        elapsedMs: performance.now() - t0,
      });
      return;
    }
    const result = evaluate(task.features, task.games, task.seed, {
      vsV2Only,
    });
    process.send!({
      type: "result",
      id: task.id,
      kind: "eval",
      result,
      elapsedMs: performance.now() - t0,
    });
  } catch (err) {
    process.send!({
      type: "error",
      id: task.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
