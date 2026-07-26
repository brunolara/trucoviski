#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* Worker do sweep: recebe {features, games, seed}, devolve CandidateResult. */
import { evaluate } from "./sweep-eval.mts";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

interface Task {
  id: number;
  features: HeuristicV2Features;
  games: number;
  seed: number;
}

// Handshake: garante que o parent só envia tarefas depois do listener existir
process.send!({ type: "ready" });

process.on("message", (task: Task) => {
  try {
    const result = evaluate(task.features, task.games, task.seed);
    process.send!({ type: "result", id: task.id, result });
  } catch (err) {
    process.send!({
      type: "error",
      id: task.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
