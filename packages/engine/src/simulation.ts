/* ------------------------------------------------------------------ */
/*  Simulação – jogos aleatórios para diagnóstico e invariantes        */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import { createPRNG } from "./prng.js";
import { createMatch } from "./match.js";
import { paulista } from "./rulesets/paulista.js";
import type { Action, PlayerView, RuleSet, Seat } from "./types.js";
import { TEAMS } from "./types.js";

// ---- Configuração ---------------------------------------------------

export interface SimulationConfig {
  /** Número de jogos a simular. */
  games: number;
  /** Semente base (cada jogo usa base + gameIndex). */
  seed?: number;
  /** Limite de ações por jogo (diagnóstico). */
  maxActions?: number;
  /** Ruleset a usar (default: paulista). */
  ruleset?: RuleSet;
  /** Callback opcional de progresso (invocado pelo chamador; engine não emite I/O). */
  onProgress?: (completed: number, total: number) => void;
}

export interface SimulationResult {
  games: number;
  completed: number;
  timedOut: number;
  averageActions: number;
  averageHands: number;
  team0Wins: number;
  team1Wins: number;
  /** Sementes de jogos que não terminaram (timeout). */
  stuckSeeds: number[];
  /** Erros encontrados (ação inválida inesperada). */
  errors: string[];
}

// ---- Execução -------------------------------------------------------

export function runSimulation(config: SimulationConfig): SimulationResult {
  const {
    games,
    seed = 42,
    maxActions = 5000,
    ruleset = paulista,
    onProgress,
  } = config;

  // PRNG determinístico separado para escolha de ações (sim reproduzível)
  const actionRng = createPRNG(seed);

  let completed = 0;
  let timedOut = 0;
  let totalActions = 0;
  let totalHands = 0;
  let team0Wins = 0;
  let team1Wins = 0;
  const stuckSeeds: number[] = [];
  const errors: string[] = [];

  for (let g = 0; g < games; g++) {
    const gameSeed = seed + g;
    const match = createMatch(ruleset, gameSeed);

    let actionCount = 0;
    let finished = false;

    while (actionCount < maxActions) {
      const s = match.state();
      if (s.phase === "matchFinished") {
        finished = true;
        totalHands += s.handNumber;
        if (s.scores[0] >= ruleset.winThreshold) team0Wins++;
        else team1Wins++;
        break;
      }

      // Encontrar o próximo jogador que pode agir
      const actor = findActor(match);
      if (!actor) {
        errors.push(
          `Game ${gameSeed}: no legal actions but match not finished (hand ${s.handNumber})`,
        );
        break;
      }

      const view: PlayerView = match.playerView(actor.seat);
      if (view.legalActions.length === 0) {
        errors.push(
          `Game ${gameSeed}: seat ${actor.seat} has no legal actions but should (hand ${s.handNumber})`,
        );
        break;
      }

      // Escolhe ação via PRNG determinístico (não Math.random)
      const action = randomAction(view, actionRng);
      const result = match.dispatch(actor.seat, action);
      if (!result.success) {
        errors.push(
          `Game ${gameSeed}: unexpected rejection "${result.error}" for action ${JSON.stringify(action)} at seat ${actor.seat}`,
        );
        break;
      }
      actionCount++;
    }

    if (finished) {
      completed++;
      totalActions += actionCount;
    } else {
      timedOut++;
      stuckSeeds.push(gameSeed);
    }

    if (onProgress) {
      onProgress(completed, g + 1);
    }
  }

  return {
    games,
    completed,
    timedOut,
    averageActions: completed > 0 ? totalActions / completed : 0,
    averageHands: completed > 0 ? totalHands / completed : 0,
    team0Wins,
    team1Wins,
    stuckSeeds,
    errors,
  };
}

// ---- Encontrar actor ------------------------------------------------

interface Actor {
  seat: Seat;
}

function findActor(match: ReturnType<typeof createMatch>): Actor | null {
  // Prioridade 1: elevenDecision
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (view.legalActions.some((a) => a.type === "elevenDecision")) {
      return { seat: seat as Seat };
    }
  }

  // Prioridade 2: quem tem vez de jogar carta (ou abrir vaza)
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

  // Prioridade 3: responder truco pendente (aceitar/recusar)
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

  // Prioridade 4: iniciar truco (baixa prioridade para não travar)
  for (let seat = 0; seat < 4; seat++) {
    const view = match.playerView(seat as Seat);
    if (view.legalActions.some((a) => a.type === "truco")) {
      return { seat: seat as Seat };
    }
  }

  return null;
}

// ---- Ação aleatória (determinística via PRNG) -----------------------

function randomAction(
  view: PlayerView,
  rng: ReturnType<typeof createPRNG>,
): Action {
  const idx = rng.nextInt(view.legalActions.length);
  return view.legalActions[idx]!;
}
