/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Heuristic Bot v2/v3 – contagem de cartas, estratégia de vaza,     */
/*  truco sensível a placar e blefe                                    */
/*                                                                      */
/*  DEFAULT_FEATURES = v2 (congelado, oponente de referência).         */
/*  V3_FEATURES = preset novo (flags + knobs; F3 calibra os knobs).    */
/* ------------------------------------------------------------------ */

import {
  RANKS,
  SUITS,
  compareCards,
  paulista,
  TEAMS,
} from "@trucoviski/engine";
import type { Card, PlayerView, Action, Team } from "@trucoviski/engine";
import { getCardStrength, myTeam, wonFirstVaza } from "./strength.js";
import { matchWinProb } from "./wtable.js";
import { assessHand, myMaxStrength } from "./assessment.js";
import type { HandAssessment } from "./assessment.js";
import { extractTrucoFeatures, extractQFeatures } from "./features.js";
import { winProbability, hasPModel } from "./pmodel.js";
import { foldProbability, hasQModel } from "./qmodel.js";
import { winProbabilityGivenCall, hasPPrimeModel } from "./pprime.js";

export type { HandAssessment } from "./assessment.js";
export { assessHand } from "./assessment.js";

/** Gerador de números aleatórios injetável (default: Math.random). Permite
 * determinismo em testes/arena e blefe real em produção. */
export type Rng = () => number;

export interface HeuristicV2Features {
  /** Aceitar sempre que carrego a carta mais forte ainda viva. */
  topAliveAccept: boolean;
  /** Como a vitória da 1ª vaza afeta o limiar de aceitar/pedir truco. */
  wonFirstVazaMode: "none" | "discount" | "override";
  /** Ajustar limiares de truco pelo placar (perdendo/ponto de match). */
  scoreSensitive: boolean;
  /** Blefe: mão fraca + adversário fraco na 1ª vaza → propor truco mesmo assim. */
  opponentWeaknessBluff: boolean;
  /** Descartar sempre a mais fraca quando o parceiro já vence a vaza, mesmo não sendo o último a jogar. */
  generalizedPartnerDiscard: boolean;
  /** Preferir cangar (empatar) a 2ª vaza a vencê-la quando já ganhamos a 1ª. */
  cangaOnPurpose: boolean;
  /** Sharpness da sigmoide de blefe (mais alto = mais determinístico). */
  sharpness: number;
  /** Ajuste fino (unidades de força de carta, 1/13) nos limiares de aceitar/pedir truco — calibração via arena (scripts/arena.mts). */
  responseBaseOffset: number;
  proposeBaseOffset: number;

  // ---- v3 flags (DEFAULT_FEATURES deixa tudo false → comportamento v2) ----
  /** Mão de onze exige contribuição dos dois, não só teamMax >= 9. */
  elevenNeedsPair: boolean;
  /** beatsTable / cardsPlayedInVaza entram no limiar de truco. */
  positionAware: boolean;
  /** myMax >= 12 deixa de aumentar incondicionalmente. */
  raiseGuard: boolean;
  /** distToWin/distToLose substituem os ±0.12 que se anulam. */
  distanceToTwelve: boolean;
  /** wonFirst/topAlive viram bônus de limiar, não return accept. */
  softOverrides: boolean;
  /** handStrength() no lugar de myMax puro. */
  topTwoStrength: boolean;

  // ---- v3 knobs (só entram com o flag correspondente ligado) ----
  /** Piso de força (0-13) que cada jogador precisa na mão de onze. */
  elevenPairFloor: number;
  /** Quanto baixar o limiar quando beatsTable. */
  positionBeatsBonus: number;
  /** Quanto baixar o limiar com ≥2 cartas na mesa. */
  positionInfoBonus: number;
  /** Com raiseGuard: só auto-raise se o próximo nível for ≤ este valor. */
  raiseGuardMaxLevel: number;
  /** Com distanceToTwelve: sobe limiar quando V cobre distToLose. */
  distDangerWeight: number;
  /** Com distanceToTwelve: desce limiar quando V cobre distToWin. */
  distFinishWeight: number;
  /** Com distanceToTwelve + respond: quanto o custo de correr (nível anterior/V) baixa o limiar. */
  runCostWeight: number;
  /** Com softOverrides: bônus (queda de limiar) por topAlive. */
  softTopAliveBonus: number;
  /** Com softOverrides: bônus (queda de limiar) por wonFirst — só no respond (F5.3). */
  softWonFirstBonus: number;

  // ---- v4 EV (plano-bot-v4-ev E1.5+) ----
  /** Decisão de truco por EV(W,p) em vez de limiares de placar. */
  useEvTruco: boolean;
  /**
   * Com useEvTruco: EV também decide aumentar (respond raise + propose).
   * false = ablation respond-only (aceitar/correr por EV; raise clássico).
   */
  useEvRaise: boolean;
  /** Sharpness da sigmoide sobre EV(aceitar)−EV(correr). */
  evSharpness: number;
}

/** Calibrado via arena: heuristic-v2 vs heuristic-v1, ~54% winrate em 24k jogos. */
export const DEFAULT_FEATURES: HeuristicV2Features = {
  topAliveAccept: true,
  wonFirstVazaMode: "override",
  scoreSensitive: true,
  opponentWeaknessBluff: true,
  generalizedPartnerDiscard: true,
  cangaOnPurpose: true,
  sharpness: 80,
  responseBaseOffset: 3,
  proposeBaseOffset: 2.5,
  // v3 off → bit-idêntico ao v2
  elevenNeedsPair: false,
  positionAware: false,
  raiseGuard: false,
  distanceToTwelve: false,
  softOverrides: false,
  topTwoStrength: false,
  elevenPairFloor: 8,
  positionBeatsBonus: 0.08,
  positionInfoBonus: 0.04,
  raiseGuardMaxLevel: 9,
  distDangerWeight: 0.14,
  distFinishWeight: 0.1,
  runCostWeight: 0.1,
  softTopAliveBonus: 0.35,
  softWonFirstBonus: 0.22,
  useEvTruco: false,
  useEvRaise: true,
  evSharpness: 30,
};

/**
 * Preset v3 — F6b (2026-07-26): F6 winner + propose mais agressivo.
 * Medido ~55,4% vs v2 (N=16k test). Ver docs/plano-bot-v3.md.
 */
export const V3_FEATURES: HeuristicV2Features = {
  ...DEFAULT_FEATURES,
  responseBaseOffset: 5,
  proposeBaseOffset: -1.5,
  elevenNeedsPair: true,
  positionAware: false,
  raiseGuard: true,
  distanceToTwelve: true,
  softOverrides: false,
  topTwoStrength: true,
  elevenPairFloor: 9,
  positionBeatsBonus: 0.15,
  positionInfoBonus: -0.06,
  raiseGuardMaxLevel: 12,
  distDangerWeight: 0.08,
  distFinishWeight: 0.14,
  runCostWeight: 0.075,
  softTopAliveBonus: 0.4,
  softWonFirstBonus: 0.15,
  // E2/E5: EV+p no respond; EV+q no propose. OFF em produção até portão.
  // (EV respond sozinho regrediu vs classic F6b; EV propose sem q explode em 12).
  useEvTruco: false,
  useEvRaise: true,
  evSharpness: 30,
};

function scoreToProbability(
  score: number,
  threshold: number,
  sharpness: number,
): number {
  // Sem clamp artificial: com sharpness alto a sigmoide já satura perto de
  // 0/1 para scores longe do limiar (decisão efetivamente determinística),
  // e só fica realmente ambígua (blefe) perto do limiar. Um clamp fixo tipo
  // min(0.95,...) forçaria ~5% de erro mesmo em mãos óbvias — testado na
  // arena e piora o bot (perde ~5-10pp de winrate vs v1 por decisão errada
  // sistemática em casos óbvios).
  return 1 / (1 + Math.exp(-sharpness * (score - threshold)));
}

/** Threshold de aceitar/pedir truco, ajustado pelo placar. */
function trucoThreshold(
  view: PlayerView,
  atRiskValue: number,
  base: number,
  features: HeuristicV2Features,
  assessment: HandAssessment,
  mode: "respond" | "propose",
): number {
  if (!features.scoreSensitive) return base;
  const team = myTeam(view);
  const oppTeam = team === 0 ? 1 : 0;
  const myScore = view.scores[team];
  const oppScore = view.scores[oppTeam];

  let threshold = base;
  if (myScore < oppScore) threshold -= 0.08;

  if (features.distanceToTwelve) {
    // F5.1: magnitude (fração do caminho restante), não binário ≡ v2
    const distLose = Math.max(1, assessment.distToLose);
    const distWin = Math.max(1, assessment.distToWin);
    const coverLose = Math.min(1, atRiskValue / distLose);
    const coverWin = Math.min(1, atRiskValue / distWin);
    threshold += features.distDangerWeight * coverLose;
    threshold -= features.distFinishWeight * coverWin;
    // Correr entrega o nível anterior: quanto mais alta a escada, mais barato aceitar
    if (mode === "respond" && atRiskValue > 0) {
      const prev = prevTrucoLevel(atRiskValue);
      threshold -= features.runCostWeight * (prev / atRiskValue);
    }
  } else {
    if (oppScore + atRiskValue >= 12) threshold += 0.12;
    if (myScore + atRiskValue >= 12) threshold -= 0.12;
  }

  if (features.positionAware) {
    // F5.2: termos independentes; knobs assinados (sweep escolhe o sinal)
    if (assessment.beatsTable) {
      threshold -=
        features.positionBeatsBonus * (assessment.isLastToPlay ? 1 : 0.5);
    }
    threshold -=
      features.positionInfoBonus * (assessment.cardsPlayedInVaza / 3);
  }

  if (features.softOverrides) {
    if (features.topAliveAccept && assessment.holdsTopAlive)
      threshold -= features.softTopAliveBonus;
    // F5.3: wonFirst só no respond — no propose a base já desconta wonFirst
    if (
      mode === "respond" &&
      features.wonFirstVazaMode !== "none" &&
      assessment.vazaScore === "won1"
    ) {
      threshold -= features.softWonFirstBonus;
    }
  }

  return Math.min(0.92, Math.max(0.15, threshold));
}

/**
 * Coberturas distanceToTwelve (F5.1) — exportada pra teste de sanidade da tabela.
 */
export function distanceCovers(
  atRiskValue: number,
  distToLose: number,
  distToWin: number,
): { coverLose: number; coverWin: number } {
  return {
    coverLose: Math.min(1, atRiskValue / Math.max(1, distToLose)),
    coverWin: Math.min(1, atRiskValue / Math.max(1, distToWin)),
  };
}

function opponentWeaknessBonus(view: PlayerView): number {
  const first = view.completedVazas[0];
  if (!first) return 0;
  const team = myTeam(view);
  const oppStrengths = ([0, 1, 2, 3] as const)
    .filter((seat) => TEAMS[seat] !== team)
    .map((seat) => first.plays[seat])
    .filter((c): c is Card => c !== null)
    .map((c) => getCardStrength(c, view.vira));
  if (oppStrengths.length === 0) return 0;
  return Math.min(...oppStrengths) <= 2 ? 0.15 : 0;
}

function nextTrucoLevel(current: number): number {
  const seq = paulista.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx === -1 || idx === seq.length - 1) return current;
  return seq[idx + 1]!;
}

function prevTrucoLevel(current: number): number {
  const seq = paulista.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx <= 0) return current;
  return seq[idx - 1]!;
}

function pickWeakest<T extends { card: Card }>(
  actions: readonly T[],
  vira: Card,
): T {
  return actions.reduce((best, a) =>
    getCardStrength(a.card, vira) < getCardStrength(best.card, vira) ? a : best,
  );
}

function strengthScore(
  assessment: HandAssessment,
  features: HeuristicV2Features,
): number {
  if (!features.topTwoStrength) return assessment.myMax / 13;
  // Âncora em myMax (escala dos offsets v2); topTwo ajusta kickers/manilhas
  return 0.65 * (assessment.myMax / 13) + 0.35 * assessment.topTwo;
}

/** p = P(vencer a mão). Modelo logístico se treinado; senão strengthScore. */
function handWinProb(
  view: PlayerView,
  assessment: HandAssessment,
  features: HeuristicV2Features,
): number {
  if (hasPModel()) return winProbability(extractTrucoFeatures(view));
  return strengthScore(assessment, features);
}

function copyScores(scores: readonly [number, number]): [number, number] {
  return [scores[0], scores[1]];
}

/** EV de terminar a mão no valor `handValue` com prob `p` de vitória da mão. */
function evHandAtValue(
  p: number,
  scores: readonly [number, number],
  team: Team,
  handValue: number,
  dealerSeat: number,
): number {
  const win = copyScores(scores);
  win[team] += handValue;
  const lose = copyScores(scores);
  lose[team === 0 ? 1 : 0] += handValue;
  return (
    p * matchWinProb(win, team, dealerSeat) +
    (1 - p) * matchWinProb(lose, team, dealerSeat)
  );
}

/** Aceita/corre (ou pede) com sigmoide sobre ΔEV — único knob de aleatoriedade. */
function evDecisionProb(deltaEv: number, sharpness: number): number {
  return 1 / (1 + Math.exp(-sharpness * deltaEv));
}

/**
 * EV de aumentar para L' (E5).
 * q · W(a+s,b) + (1−q) · [p'·W(a+L',b) + (1−p')·W(a,b+L')]
 */
function evRaiseToLevel(
  view: PlayerView,
  assessment: HandAssessment,
  features: HeuristicV2Features,
  currentValue: number,
  nextLevel: number,
): number {
  const team = myTeam(view);
  const q = hasQModel()
    ? foldProbability(extractQFeatures(view, nextLevel))
    : 0;
  const pPrime = hasPPrimeModel()
    ? winProbabilityGivenCall(extractTrucoFeatures(view))
    : handWinProb(view, assessment, features);
  const foldScores = copyScores(view.scores);
  foldScores[team] += currentValue;
  const evFold = matchWinProb(foldScores, team, view.dealerSeat);
  const evShow = evHandAtValue(
    pPrime,
    view.scores,
    team,
    nextLevel,
    view.dealerSeat,
  );
  return q * evFold + (1 - q) * evShow;
}

/** EV de seguir a mão no valor atual (sem aumentar). */
function evContinueAtValue(
  view: PlayerView,
  assessment: HandAssessment,
  features: HeuristicV2Features,
  handValue: number,
): number {
  const p = handWinProb(view, assessment, features);
  return evHandAtValue(
    p,
    view.scores,
    myTeam(view),
    handValue,
    view.dealerSeat,
  );
}

export function decideHeuristicV2Action(
  view: PlayerView,
  rng: Rng = Math.random,
  features: HeuristicV2Features = DEFAULT_FEATURES,
): Action | null {
  const actions = view.legalActions;
  if (actions.length === 0) return null;

  const assessment = assessHand(view);

  // 1. Mão de onze
  const elevenActions = actions.filter((a) => a.type === "elevenDecision");
  if (elevenActions.length > 0) {
    const allCards = [...view.handCards, ...(view.partnerCards ?? [])];
    const myMax = assessment.myMax;
    const partnerMax = myMaxStrength(view.partnerCards ?? [], view.vira);
    const teamMax = Math.max(myMax, partnerMax);
    const goodCount = allCards.filter(
      (c) => getCardStrength(c, view.vira) >= 8,
    ).length;

    let decision: "play" | "run";
    if (features.elevenNeedsPair) {
      const floor = features.elevenPairFloor;
      if (
        teamMax >= 11 ||
        goodCount >= 3 ||
        (myMax >= floor && partnerMax >= floor && goodCount >= 2)
      ) {
        decision = "play";
      } else if (myMax >= floor && partnerMax >= floor) {
        const prob = scoreToProbability(
          Math.min(myMax, partnerMax) / 13,
          floor / 13,
          features.sharpness,
        );
        decision = rng() < prob ? "play" : "run";
      } else {
        decision = "run";
      }
    } else if (
      teamMax >= 11 ||
      goodCount >= 3 ||
      (myMax >= 9 && partnerMax >= 8)
    ) {
      decision = "play";
    } else {
      const prob = scoreToProbability(
        teamMax / 13,
        8.5 / 13,
        features.sharpness,
      );
      decision = rng() < prob ? "play" : "run";
    }
    const selected = elevenActions.find(
      (a) => (a as { decision: string }).decision === decision,
    );
    if (selected) return selected;
  }

  // 2. Responder truco (aceitar/correr/aumentar)
  const trucoResponses = actions.filter(
    (a) =>
      a.type === "truco" &&
      ((a as { action: string }).action === "accept" ||
        (a as { action: string }).action === "run"),
  );
  if (trucoResponses.length > 0) {
    const atRisk = view.trucoPendingValue ?? view.trucoValue;
    const canRaise = actions.some(
      (a) => a.type === "truco" && (a as { action: string }).action === "raise",
    );
    const raiseAction = actions.find(
      (a) => a.type === "truco" && (a as { action: string }).action === "raise",
    );

    if (assessment.myMax >= 12 && canRaise && raiseAction) {
      if (!features.raiseGuard) {
        return raiseAction;
      }
      // Guard: só auto-raise se o nível resultante for ≤ raiseGuardMaxLevel
      const raiseTo = nextTrucoLevel(atRisk);
      if (raiseTo <= features.raiseGuardMaxLevel) {
        return raiseAction;
      }
    }

    const wonFirst = assessment.vazaScore === "won1";
    if (!features.softOverrides) {
      if (
        (features.topAliveAccept && assessment.holdsTopAlive) ||
        (features.wonFirstVazaMode === "override" && wonFirst)
      ) {
        return (
          trucoResponses.find(
            (a) => (a as { action: string }).action === "accept",
          ) ?? null
        );
      }
    }

    if (features.useEvTruco) {
      const team = myTeam(view);
      const L = atRisk;
      const s = prevTrucoLevel(atRisk);
      const pendingTeam = view.trucoPendingTeam ?? (team === 0 ? 1 : 0);
      const p = handWinProb(view, assessment, features);
      const evAccept = evHandAtValue(p, view.scores, team, L, view.dealerSeat);
      const runScores = copyScores(view.scores);
      runScores[pendingTeam] += s;
      const evRun = matchWinProb(runScores, team, view.dealerSeat);

      // E5: se pode aumentar e q está pronto, compare raise vs accept vs run
      if (features.useEvRaise && canRaise && raiseAction && hasQModel()) {
        const Lprime = nextTrucoLevel(atRisk);
        if (!features.raiseGuard || Lprime <= features.raiseGuardMaxLevel) {
          // Se ele correr do nosso raise, entrega L (valor pendente que aumentamos)
          const evRaise = evRaiseToLevel(view, assessment, features, L, Lprime);
          // Escolhe a melhor entre raise / accept / run via soft-max de 2 passos
          const bestContinue = Math.max(evRaise, evAccept);
          const continueIsRaise = evRaise >= evAccept;
          const probContinue = evDecisionProb(
            bestContinue - evRun,
            features.evSharpness,
          );
          if (rng() >= probContinue) {
            return (
              trucoResponses.find(
                (a) => (a as { action: string }).action === "run",
              ) ?? null
            );
          }
          if (continueIsRaise) return raiseAction;
          return (
            trucoResponses.find(
              (a) => (a as { action: string }).action === "accept",
            ) ?? null
          );
        }
      }

      const prob = evDecisionProb(evAccept - evRun, features.evSharpness);
      const decision = rng() < prob ? "accept" : "run";
      return (
        trucoResponses.find(
          (a) => (a as { action: string }).action === decision,
        ) ?? null
      );
    }

    const discount =
      features.wonFirstVazaMode === "discount" && wonFirst ? 2.5 / 13 : 0;
    const base =
      (view.completedVazas.length === 0 ? 6.5 / 13 : 7.5 / 13) -
      discount +
      features.responseBaseOffset / 13;
    const threshold = trucoThreshold(
      view,
      atRisk,
      base,
      features,
      assessment,
      "respond",
    );
    const prob = scoreToProbability(
      strengthScore(assessment, features),
      threshold,
      features.sharpness,
    );
    const decision = rng() < prob ? "accept" : "run";
    const selected = trucoResponses.find(
      (a) => (a as { action: string }).action === decision,
    );
    return selected ?? null;
  }

  // 3. Propor truco
  const trucoProposals = actions.filter(
    (a) => a.type === "truco" && (a as { action: string }).action === "raise",
  );
  if (trucoProposals.length > 0) {
    const wonFirst = assessment.vazaScore === "won1";
    const nextLevel = nextTrucoLevel(view.trucoValue);
    // raiseGuard também na proposta: sem escape por manilha (myMax>=12).
    if (features.raiseGuard && nextLevel > features.raiseGuardMaxLevel) {
      // cai pra jogar carta
    } else if (features.useEvTruco && features.useEvRaise && hasQModel()) {
      // E5: EV(aumentar) vs EV(seguir no valor atual)
      const s = view.trucoValue;
      const evRaise = evRaiseToLevel(view, assessment, features, s, nextLevel);
      const evPass = evContinueAtValue(view, assessment, features, s);
      const prob = evDecisionProb(evRaise - evPass, features.evSharpness);
      if (rng() < prob) {
        return trucoProposals[0] ?? null;
      }
    } else {
      // Propor: limiar clássico (EV de raise precisa de q=P(corre)).
      const base =
        (wonFirst ? 7.5 / 13 : 9.5 / 13) + features.proposeBaseOffset / 13;
      const threshold = trucoThreshold(
        view,
        nextLevel,
        base,
        features,
        assessment,
        "propose",
      );
      const score =
        strengthScore(assessment, features) +
        (features.opponentWeaknessBluff ? opponentWeaknessBonus(view) : 0);
      if (rng() < scoreToProbability(score, threshold, features.sharpness)) {
        return trucoProposals[0] ?? null;
      }
    }
  }

  // 4. Jogar carta
  const playCardActions = actions.filter((a) => a.type === "playCard") as {
    type: "playCard";
    card: Card;
  }[];
  if (playCardActions.length > 0) {
    const vazaIndex = view.completedVazas.length;
    const isOpening =
      !view.currentVaza || view.currentVaza.plays.every((p) => p === null);

    if (isOpening) {
      return pickWeakest(playCardActions, view.vira);
    }

    if (
      assessment.partnerIsWinning &&
      (features.generalizedPartnerDiscard || assessment.isLastToPlay)
    ) {
      return pickWeakest(playCardActions, view.vira);
    }

    const bestCard = assessment.bestCardOnTable;
    if (bestCard) {
      const winningActions = playCardActions.filter(
        (a) => compareCards(a.card, bestCard, view.vira, RANKS, SUITS) > 0,
      );

      if (features.cangaOnPurpose && vazaIndex === 1 && wonFirstVaza(view)) {
        const tieActions = playCardActions.filter(
          (a) => compareCards(a.card, bestCard, view.vira, RANKS, SUITS) === 0,
        );
        if (tieActions.length > 0) {
          return pickWeakest(tieActions, view.vira);
        }
      }

      if (winningActions.length > 0) {
        return pickWeakest(winningActions, view.vira);
      }
    }

    return pickWeakest(playCardActions, view.vira);
  }

  // 5. Ferro: playHiddenCard
  const playHiddenActions = actions.filter((a) => a.type === "playHiddenCard");
  if (playHiddenActions.length > 0) {
    return playHiddenActions[0] ?? null;
  }

  return actions.find((a) => a.type !== "surrender") ?? null;
}

/** Política v3: mesmo motor, preset V3_FEATURES. */
export function decideHeuristicV3Action(
  view: PlayerView,
  rng: Rng = Math.random,
  features: HeuristicV2Features = V3_FEATURES,
): Action | null {
  return decideHeuristicV2Action(view, rng, features);
}
