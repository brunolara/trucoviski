#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  Script: pnpm tsx scripts/sim-heuristic.mts                        */
/*  Simulação Heurístico vs Random para provar taxa de vitória >= 65%  */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  createPRNG,
  createMatch,
  paulista,
  TEAMS,
} from "../packages/engine/src/index.js";
import { decideHeuristicAction } from "../packages/bots/src/index.js";
import type { Action, Seat } from "../packages/engine/src/index.js";

const gameCount = 2000;
const seedBase = 12345;
const maxActionsPerGame = 5000;

interface Actor {
  seat: Seat;
}

function findActor(match: ReturnType<typeof createMatch>): Actor | null {
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (view.legalActions.some((a) => a.type === "elevenDecision")) {
      return { seat: seat as Seat };
    }
  }
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (
      view.legalActions.some(
        (a) => a.type === "playCard" || a.type === "playHiddenCard",
      )
    ) {
      return { seat: seat as Seat };
    }
  }
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (view.trucoPendingTeam !== null) {
      if (
        TEAMS[seat as Seat] !== view.trucoPendingTeam &&
        view.legalActions.some((a) => a.type === "truco")
      ) {
        return { seat: seat as Seat };
      }
    }
  }
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (view.legalActions.some((a) => a.type === "truco")) {
      return { seat: seat as Seat };
    }
  }
  return null;
}

async function main() {
  console.log(
    `Running ${gameCount} games: Heuristic (Team 0) vs Random (Team 1)...`,
  );

  const actionRng = createPRNG(seedBase);
  let team0Wins = 0;
  let team1Wins = 0;
  let timedOut = 0;

  const start = performance.now();

  for (let g = 0; g < gameCount; g++) {
    const gameSeed = seedBase + g;
    const match = createMatch(paulista, gameSeed);
    let actionsCount = 0;
    let finished = false;

    while (actionsCount < maxActionsPerGame) {
      const s = match.state();
      if (s.phase === "matchFinished") {
        finished = true;
        if (s.scores[0] >= paulista.winThreshold) team0Wins++;
        else team1Wins++;
        break;
      }

      const actor = findActor(match);
      if (!actor) break;

      const view = match.playerView(actor.seat);
      if (view.legalActions.length === 0) break;

      let action: Action;
      const isHeuristic = actor.seat === 0 || actor.seat === 2;

      if (isHeuristic) {
        const decided = decideHeuristicAction(view);
        action =
          decided ??
          view.legalActions[actionRng.nextInt(view.legalActions.length)]!;
      } else {
        // Random bot
        const idx = actionRng.nextInt(view.legalActions.length);
        action = view.legalActions[idx]!;
      }

      const res = match.dispatch(actor.seat, action);
      if (!res.success) {
        console.error(`Invalid action at game ${gameSeed}: ${res.error}`);
        break;
      }
      actionsCount++;
    }

    if (!finished) {
      timedOut++;
    }
  }

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  const winRate = (team0Wins / (team0Wins + team1Wins)) * 100;

  console.log(`\nSimulation Completed in ${elapsed}s`);
  console.log(`  Games run:   ${gameCount}`);
  console.log(
    `  T0 wins:     ${team0Wins} (${winRate.toFixed(2)}%) [Heuristic]`,
  );
  console.log(
    `  T1 wins:     ${team1Wins} (${(100 - winRate).toFixed(2)}%) [Random]`,
  );
  console.log(`  Timed out:   ${timedOut}`);

  if (winRate < 65) {
    console.error(
      `\nFAILURE: Heuristic bot win rate is ${winRate.toFixed(2)}%, which is below the 65% threshold!`,
    );
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: Heuristic bot win rate is >= 65%!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
