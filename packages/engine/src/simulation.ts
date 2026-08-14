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

// ---- Arena: política vs política --------------------------------------

export type BotPolicy = (view: PlayerView) => Action | null;

export interface ArenaConfig {
  /** Número de seeds a simular (com mirrored, cada seed roda 2×). */
  games: number;
  /** Política A (reportada como team0Wins / winRateTeam0). */
  policyTeam0: BotPolicy;
  /** Política B (reportada como team1Wins). */
  policyTeam1: BotPolicy;
  /** Semente base (cada jogo usa base + gameIndex). */
  seed?: number;
  /** Limite de ações por jogo (diagnóstico). */
  maxActions?: number;
  /** Ruleset a usar (default: paulista). */
  ruleset?: RuleSet;
  /**
   * Se true, cada seed roda duas vezes com os lados trocados e as vitórias
   * são atribuídas à política (não ao assento). Cancela viés posicional.
   */
  mirrored?: boolean;
}

export interface ArenaDiagnostics {
  /** Contagem de partidas fechadas por valor da mão decisiva. */
  closingHandValues: Record<number, number>;
  /** Partidas cuja mão decisiva foi mão de onze (ou ferro 11×11). */
  closingElevenHands: number;
  /** Partidas perdidas pela política A numa mão de valor ≥ 9. */
  policy0LossesOnBigHand: number;
  /** Partidas perdidas pela política B numa mão de valor ≥ 9. */
  policy1LossesOnBigHand: number;
  /** Mãos de onze jogadas (play) e perdidas pela política A. */
  policy0ElevenPlayedAndLost: number;
  /** Mãos de onze jogadas (play) e perdidas pela política B. */
  policy1ElevenPlayedAndLost: number;
  /** Accept/run/raise da política A, pelo valor pendente/atingido. */
  policy0TrucoAcceptByLevel: Record<number, number>;
  policy0TrucoRunByLevel: Record<number, number>;
  policy0TrucoRaiseByLevel: Record<number, number>;
  /** Accept/run/raise da política B, pelo valor pendente/atingido. */
  policy1TrucoAcceptByLevel: Record<number, number>;
  policy1TrucoRunByLevel: Record<number, number>;
  policy1TrucoRaiseByLevel: Record<number, number>;
  /** Tentos que a política A recebeu porque o oponente correu. */
  policy0PointsFromRun: number;
  /** Tentos que a política B recebeu porque o oponente correu. */
  policy1PointsFromRun: number;
}

export interface ArenaResult {
  /** Seeds pedidas (não conta o ×2 do espelho). */
  games: number;
  /** Partidas efetivamente rodadas (games × 2 se mirrored). */
  matchesPlayed: number;
  completed: number;
  timedOut: number;
  /** Vitórias da policyTeam0 (independente do assento quando mirrored). */
  team0Wins: number;
  /** Vitórias da policyTeam1. */
  team1Wins: number;
  /** Taxa de vitória da policyTeam0 entre os jogos completados (0..1). */
  winRateTeam0: number;
  /**
   * IC95% de winRateTeam0. Unidade = seed (par espelhado se mirrored),
   * não cada partida.
   */
  winRateTeam0CI95: { lo: number; hi: number; n: number };
  errors: string[];
  mirrored: boolean;
  elapsedMs: number;
  gamesPerSecond: number;
  diagnostics: ArenaDiagnostics;
}

function emptyDiagnostics(): ArenaDiagnostics {
  return {
    closingHandValues: {},
    closingElevenHands: 0,
    policy0LossesOnBigHand: 0,
    policy1LossesOnBigHand: 0,
    policy0ElevenPlayedAndLost: 0,
    policy1ElevenPlayedAndLost: 0,
    policy0TrucoAcceptByLevel: {},
    policy0TrucoRunByLevel: {},
    policy0TrucoRaiseByLevel: {},
    policy1TrucoAcceptByLevel: {},
    policy1TrucoRunByLevel: {},
    policy1TrucoRaiseByLevel: {},
    policy0PointsFromRun: 0,
    policy1PointsFromRun: 0,
  };
}

/** IC95% pela média das taxas por seed (0, 0.5 ou 1 quando espelhado). */
export function ci95FromRates(rates: readonly number[]): {
  lo: number;
  hi: number;
  n: number;
} {
  const n = rates.length;
  if (n === 0) return { lo: 0, hi: 1, n: 0 };
  const mean = rates.reduce((a, x) => a + x, 0) / n;
  if (n < 2) return { lo: 0, hi: 1, n };
  let ss = 0;
  for (const x of rates) {
    const d = x - mean;
    ss += d * d;
  }
  const se = Math.sqrt(ss / (n * (n - 1)));
  const z = 1.96;
  return { lo: mean - z * se, hi: mean + z * se, n };
}

function bump(map: Record<number, number>, key: number): void {
  map[key] = (map[key] ?? 0) + 1;
}

interface SingleMatchOutcome {
  finished: boolean;
  /** 0 = policy sentada como time 0 ganhou o placar de assento. */
  seatWinner: 0 | 1 | null;
  error: string | null;
}

/**
 * Roda `games` partidas completas com uma política por time, e reporta o
 * placar agregado. Com `mirrored`, cada seed roda nos dois lados.
 */
export function runArena(config: ArenaConfig): ArenaResult {
  const {
    games,
    policyTeam0,
    policyTeam1,
    seed = 42,
    maxActions = 5000,
    ruleset = paulista,
    mirrored = false,
  } = config;

  const start = performance.now();
  const fallbackRng = createPRNG(seed);
  const diagnostics = emptyDiagnostics();

  let completed = 0;
  let timedOut = 0;
  let team0Wins = 0;
  let team1Wins = 0;
  const errors: string[] = [];
  let matchesPlayed = 0;
  const pairRates: number[] = [];

  const orientations: Array<{
    p0: BotPolicy;
    p1: BotPolicy;
    /** Se true, policyTeam0 está sentada no time de assento 0. */
    policy0IsSeat0: boolean;
  }> = mirrored
    ? [
        { p0: policyTeam0, p1: policyTeam1, policy0IsSeat0: true },
        { p0: policyTeam1, p1: policyTeam0, policy0IsSeat0: false },
      ]
    : [{ p0: policyTeam0, p1: policyTeam1, policy0IsSeat0: true }];

  for (let g = 0; g < games; g++) {
    const gameSeed = seed + g;
    let pairPolicy0Wins = 0;
    let pairCompleted = 0;
    for (const ori of orientations) {
      matchesPlayed++;
      const outcome = runSingleMatch({
        gameSeed,
        policySeat0: ori.p0,
        policySeat1: ori.p1,
        policy0IsSeat0: ori.policy0IsSeat0,
        maxActions,
        ruleset,
        fallbackRng,
        diagnostics,
      });
      if (outcome.error) errors.push(outcome.error);
      if (!outcome.finished || outcome.seatWinner === null) {
        timedOut++;
        continue;
      }
      completed++;
      const policy0Won = ori.policy0IsSeat0
        ? outcome.seatWinner === 0
        : outcome.seatWinner === 1;
      if (policy0Won) {
        team0Wins++;
        pairPolicy0Wins++;
      } else {
        team1Wins++;
      }
      pairCompleted++;
    }
    if (pairCompleted > 0) {
      pairRates.push(pairPolicy0Wins / pairCompleted);
    }
  }

  const elapsedMs = performance.now() - start;
  return {
    games,
    matchesPlayed,
    completed,
    timedOut,
    team0Wins,
    team1Wins,
    winRateTeam0: completed > 0 ? team0Wins / completed : 0,
    winRateTeam0CI95: ci95FromRates(pairRates),
    errors,
    mirrored,
    elapsedMs,
    gamesPerSecond: elapsedMs > 0 ? (matchesPlayed * 1000) / elapsedMs : 0,
    diagnostics,
  };
}

function runSingleMatch(args: {
  gameSeed: number;
  policySeat0: BotPolicy;
  policySeat1: BotPolicy;
  policy0IsSeat0: boolean;
  maxActions: number;
  ruleset: RuleSet;
  fallbackRng: ReturnType<typeof createPRNG>;
  diagnostics: ArenaDiagnostics;
}): SingleMatchOutcome {
  const {
    gameSeed,
    policySeat0,
    policySeat1,
    policy0IsSeat0,
    maxActions,
    ruleset,
    fallbackRng,
    diagnostics,
  } = args;
  const match = createMatch(ruleset, gameSeed);

  let actionCount = 0;
  let lastHandTentos = 0;
  let lastHandWasEleven = false;
  let lastHandElevenPlayed: 0 | 1 | null = null;
  let lastHandWinner: 0 | 1 | null = null;
  let elevenTeamThisHand: 0 | 1 | null = null;
  let elevenPlayedThisHand = false;

  while (actionCount < maxActions) {
    const s = match.state();
    if (s.phase === "matchFinished") {
      // Mão decisiva
      bump(diagnostics.closingHandValues, lastHandTentos);
      if (lastHandWasEleven) diagnostics.closingElevenHands++;
      if (lastHandWinner !== null) {
        const seatLoser: 0 | 1 = lastHandWinner === 0 ? 1 : 0;
        const policyLoserIs0 = policy0IsSeat0
          ? seatLoser === 0
          : seatLoser === 1;
        if (lastHandTentos >= 9) {
          if (policyLoserIs0) diagnostics.policy0LossesOnBigHand++;
          else diagnostics.policy1LossesOnBigHand++;
        }
        if (lastHandWasEleven && lastHandElevenPlayed !== null) {
          const playedSeat = lastHandElevenPlayed;
          const playedAndLost = playedSeat === seatLoser;
          if (playedAndLost) {
            const policyPlayedIs0 = policy0IsSeat0
              ? playedSeat === 0
              : playedSeat === 1;
            if (policyPlayedIs0) diagnostics.policy0ElevenPlayedAndLost++;
            else diagnostics.policy1ElevenPlayedAndLost++;
          }
        }
      }
      const seatWinner: 0 | 1 = s.scores[0] >= ruleset.winThreshold ? 0 : 1;
      return { finished: true, seatWinner, error: null };
    }

    // Detecta mão de onze / ferro pelo HandState atual
    if (
      s.hand &&
      (s.phase === "elevenDecision" || s.hand.isElevenHand || s.hand.isFerro)
    ) {
      lastHandWasEleven = true;
      if (s.hand.isFerro) {
        elevenTeamThisHand = null;
      } else if (s.scores[0] === ruleset.elevenThreshold) {
        elevenTeamThisHand = 0;
      } else if (s.scores[1] === ruleset.elevenThreshold) {
        elevenTeamThisHand = 1;
      }
    }

    const actor = findActor(match);
    if (!actor) {
      return {
        finished: false,
        seatWinner: null,
        error: `Game ${gameSeed}: no legal actions but match not finished (hand ${s.handNumber})`,
      };
    }

    const view: PlayerView = match.playerView(actor.seat);
    if (view.legalActions.length === 0) {
      return {
        finished: false,
        seatWinner: null,
        error: `Game ${gameSeed}: seat ${actor.seat} has no legal actions but should (hand ${s.handNumber})`,
      };
    }

    const policy = TEAMS[actor.seat] === 0 ? policySeat0 : policySeat1;
    const decided = policy(view);
    const action =
      decided ??
      view.legalActions[fallbackRng.nextInt(view.legalActions.length)]!;

    // Contagem de truco pela ação escolhida, atribuída à política do ator
    if (action.type === "truco") {
      const level =
        view.trucoPendingValue ??
        (action.action === "raise"
          ? nextPendingTruco(view.trucoValue, ruleset)
          : view.trucoValue);
      const actorIsPolicy0 = policy0IsSeat0
        ? TEAMS[actor.seat] === 0
        : TEAMS[actor.seat] === 1;
      const accept = actorIsPolicy0
        ? diagnostics.policy0TrucoAcceptByLevel
        : diagnostics.policy1TrucoAcceptByLevel;
      const run = actorIsPolicy0
        ? diagnostics.policy0TrucoRunByLevel
        : diagnostics.policy1TrucoRunByLevel;
      const raise = actorIsPolicy0
        ? diagnostics.policy0TrucoRaiseByLevel
        : diagnostics.policy1TrucoRaiseByLevel;
      if (action.action === "accept") bump(accept, level);
      else if (action.action === "run") bump(run, level);
      else if (action.action === "raise") bump(raise, level);
    }

    const result = match.dispatch(actor.seat, action);
    if (!result.success) {
      return {
        finished: false,
        seatWinner: null,
        error: `Game ${gameSeed}: unexpected rejection "${result.error}" for action ${JSON.stringify(action)} at seat ${actor.seat}`,
      };
    }

    for (const ev of result.events) {
      if (ev.type === "elevenDecided") {
        elevenPlayedThisHand = ev.decision === "play";
        lastHandWasEleven = true;
      }
      if (ev.type === "handFinished") {
        lastHandTentos = ev.tentos;
        lastHandWinner = ev.winnerTeam;
        if (elevenPlayedThisHand && elevenTeamThisHand !== null) {
          lastHandElevenPlayed = elevenTeamThisHand;
        } else {
          lastHandElevenPlayed = null;
        }
        if (ev.reason === "run") {
          const winnerIsPolicy0 = policy0IsSeat0
            ? ev.winnerTeam === 0
            : ev.winnerTeam === 1;
          if (winnerIsPolicy0) diagnostics.policy0PointsFromRun += ev.tentos;
          else diagnostics.policy1PointsFromRun += ev.tentos;
        }
        elevenTeamThisHand = null;
        elevenPlayedThisHand = false;
      }
      if (ev.type === "handStarted") {
        lastHandWasEleven = false;
        lastHandElevenPlayed = null;
        elevenTeamThisHand = null;
        elevenPlayedThisHand = false;
      }
    }

    actionCount++;
  }

  return { finished: false, seatWinner: null, error: null };
}

function nextPendingTruco(current: number, ruleset: RuleSet): number {
  const seq = ruleset.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx === -1 || idx >= seq.length - 1) return current;
  return seq[idx + 1]!;
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
