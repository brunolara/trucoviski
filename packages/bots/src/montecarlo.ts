/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Monte Carlo Bot (F3) – determinização + rollout (PIMC)             */
/*                                                                      */
/*  Para cada ação legal, amostra N mundos possíveis (cartas dos        */
/*  adversários consistentes com o que já foi visto), simula o resto    */
/*  da mão com a heurística v2 como política de rollout, e escolhe a    */
/*  ação com maior valor esperado em tentos. Unifica jogar carta,       */
/*  truco e desistência sob a mesma pergunta: qual ação maximiza EV?    */
/*                                                                      */
/*  Simplificação assumida: durante o rollout de vazas não modelamos    */
/*  novas propostas de truco (só a proposta imediata da ação raiz é     */
/*  resolvida); ponytail: suficiente para o valor de jogadas de carta,  */
/*  upgrade seria simular truco recursivamente se a IA parecer fraca em */
/*  decisões de aumento em mãos avançadas.                              */
/* ------------------------------------------------------------------ */

import {
  RANKS,
  SUITS,
  TEAMS,
  createDeck,
  completeVaza,
  isVazaComplete,
  nextVazaStarter,
  paulista,
  playInVaza,
  resolveHandWinner,
  startVaza,
} from "@trucoviski/engine";
import type {
  Action,
  Card,
  CompletedVaza,
  PlayerView,
  Seat,
  Team,
  VazaInProgress,
} from "@trucoviski/engine";
import { decideHeuristicV2Action } from "./heuristic2.js";
import type { Rng } from "./heuristic2.js";
import { cardKey, collectSeenCards, partnerSeatOf } from "./strength.js";

export type RolloutPolicy = (view: PlayerView, rng: Rng) => Action | null;

export interface MonteCarloOptions {
  /** Amostras (determinizações) por ação candidata. Default: 100. */
  samples?: number;
  rng?: Rng;
  /** Política usada para simular jogadas de todos os assentos no rollout. */
  rolloutPolicy?: RolloutPolicy;
}

interface World {
  vira: Card;
  hands: [Card[], Card[], Card[], Card[]];
  dealerSeat: Seat;
}

function cloneWorld(world: World): World {
  return {
    vira: world.vira,
    dealerSeat: world.dealerSeat,
    hands: world.hands.map((h) => [...h]) as [Card[], Card[], Card[], Card[]],
  };
}

export function decideMonteCarloAction(
  view: PlayerView,
  opts: MonteCarloOptions = {},
): Action | null {
  const actions = view.legalActions;
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0]!;

  const rng = opts.rng ?? Math.random;
  const samples = opts.samples ?? 100;
  const rolloutPolicy = opts.rolloutPolicy ?? decideHeuristicV2Action;
  const myTeam = TEAMS[view.mySeat];

  // Números aleatórios comuns: as mesmas N determinizações são reusadas para
  // todas as ações candidatas, então a comparação entre ações não é poluída
  // por ruído de "mundos" diferentes — reduz muito a variância por amostra.
  const worlds: World[] = [];
  for (let s = 0; s < samples; s++)
    worlds.push(sampleDeterminization(view, rng));

  let bestAction: Action = actions[0]!;
  let bestValue = -Infinity;

  for (const action of actions) {
    const shortcut = deterministicValue(view, action);
    let value: number;
    if (shortcut !== null) {
      value = shortcut;
    } else {
      let total = 0;
      for (const world of worlds) {
        total += simulateAction(
          view,
          cloneWorld(world),
          action,
          myTeam,
          rolloutPolicy,
          rng,
        );
      }
      value = total / worlds.length;
    }
    if (value > bestValue) {
      bestValue = value;
      bestAction = action;
    }
  }
  return bestAction;
}

// ---- Atalhos determinísticos (não dependem de cartas escondidas) -----

function deterministicValue(view: PlayerView, action: Action): number | null {
  if (action.type === "surrender") return -view.trucoValue;
  if (action.type === "elevenDecision" && action.decision === "run") return -1;
  if (action.type === "truco" && action.action === "run") {
    return -previousTrucoLevel(view.trucoPendingValue ?? view.trucoValue);
  }
  return null;
}

// ---- Truco: sequência de valores ------------------------------------

function nextTrucoLevel(current: number): number {
  const seq = paulista.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx === -1 || idx === seq.length - 1) return current;
  return seq[idx + 1]!;
}

function previousTrucoLevel(current: number): number {
  const seq = paulista.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx <= 0) return seq[0]!;
  return seq[idx - 1]!;
}

function seatForTeam(team: Team): Seat {
  return team === 0 ? 0 : 1;
}

// ---- Determinização: amostra cartas plausíveis dos adversários ------

function playedCount(view: PlayerView, seat: Seat): number {
  let n = 0;
  for (const v of view.completedVazas) {
    if (v.plays[seat] !== null || v.covered[seat]) n++;
  }
  if (
    view.currentVaza &&
    (view.currentVaza.plays[seat] !== null || view.currentVaza.covered[seat])
  ) {
    n++;
  }
  return n;
}

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function sampleDeterminization(view: PlayerView, rng: Rng): World {
  const mySeat = view.mySeat;
  const partnerSeat = partnerSeatOf(mySeat);
  const knownSeats = new Set<Seat>([mySeat]);
  const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
  hands[mySeat] = [...view.handCards];

  if (view.partnerCards) {
    hands[partnerSeat] = [...view.partnerCards];
    knownSeats.add(partnerSeat);
  }

  const knownKeys = new Set(collectSeenCards(view).map(cardKey));
  const pool = createDeck().filter((c) => !knownKeys.has(cardKey(c)));
  shuffleInPlace(pool, rng);

  let idx = 0;
  for (const seat of [0, 1, 2, 3] as const) {
    if (knownSeats.has(seat)) continue;
    const count = paulista.cardsPerPlayer - playedCount(view, seat);
    hands[seat] = pool.slice(idx, idx + count);
    idx += count;
  }

  return { vira: view.vira, hands, dealerSeat: view.dealerSeat };
}

// ---- Aplicar carta escolhida a uma vaza em progresso -----------------

function applyCardAction(
  cv: VazaInProgress,
  world: World,
  seat: Seat,
  action: Action,
): VazaInProgress {
  const hand = world.hands[seat];
  if (action.type === "playCard") {
    const idx = hand.findIndex(
      (c) => c.suit === action.card.suit && c.rank === action.card.rank,
    );
    const card = hand.splice(idx >= 0 ? idx : 0, 1)[0] ?? null;
    return playInVaza(cv, seat, card, false);
  }
  if (action.type === "playHiddenCard") {
    const idx = Math.max(0, Math.min(action.cardIndex, hand.length - 1));
    hand.splice(idx, 1);
    return playInVaza(cv, seat, null, true);
  }
  const card = hand.splice(0, 1)[0] ?? null;
  return playInVaza(cv, seat, card, false);
}

// ---- Construção de PlayerView sintético para o rollout ----------------

function buildPlayView(
  seat: Seat,
  world: World,
  vazas: readonly CompletedVaza[],
  cv: VazaInProgress,
  scores: readonly [number, number],
  trucoValue: number,
): PlayerView {
  const handCards = world.hands[seat];
  const legalActions: Action[] = [];
  if (cv.currentSeat === seat) {
    for (const c of handCards) legalActions.push({ type: "playCard", card: c });
    if (vazas.length >= 1) {
      for (let i = 0; i < handCards.length; i++) {
        legalActions.push({ type: "playHiddenCard", cardIndex: i });
      }
    }
  }
  return {
    handNumber: 0,
    mySeat: seat,
    dealerSeat: world.dealerSeat,
    handCards,
    partnerCards: undefined,
    vira: world.vira,
    completedVazas: vazas,
    currentVaza: cv,
    scores,
    trucoValue,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions,
  };
}

function buildTrucoView(
  seat: Seat,
  world: World,
  vazas: readonly CompletedVaza[],
  cv: VazaInProgress | null,
  scores: readonly [number, number],
  trucoValue: number,
  pendingTeam: Team,
  pendingValue: number,
): PlayerView {
  const legalActions: Action[] = [
    { type: "truco", action: "accept" },
    { type: "truco", action: "run" },
  ];
  const nxt = nextTrucoLevel(pendingValue);
  if (nxt > pendingValue) legalActions.push({ type: "truco", action: "raise" });
  return {
    handNumber: 0,
    mySeat: seat,
    dealerSeat: world.dealerSeat,
    handCards: world.hands[seat],
    partnerCards: undefined,
    vira: world.vira,
    completedVazas: vazas,
    currentVaza: cv,
    scores,
    trucoValue,
    trucoPendingTeam: pendingTeam,
    trucoPendingValue: pendingValue,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions,
  };
}

// ---- Rollout de vazas até a mão resolver ------------------------------

function playOutVazas(
  world: World,
  vazasIn: readonly CompletedVaza[],
  cvIn: VazaInProgress | null,
  trucoValue: number,
  scores: readonly [number, number],
  myTeam: Team,
  rolloutPolicy: RolloutPolicy,
  rng: Rng,
): number {
  const vazas = [...vazasIn];
  let cv = cvIn;
  const dealerSeat = world.dealerSeat;

  for (let guard = 0; guard < 20; guard++) {
    const resolved = resolveHandWinner(vazas, dealerSeat);
    if (resolved !== null)
      return resolved === myTeam ? trucoValue : -trucoValue;

    if (!cv) {
      const starter =
        vazas.length === 0
          ? dealerSeat
          : nextVazaStarter(vazas[vazas.length - 1]!, dealerSeat);
      cv = startVaza(starter);
    }

    const seat = cv.currentSeat;
    if (world.hands[seat].length === 0) return 0;

    const v = buildPlayView(seat, world, vazas, cv, scores, trucoValue);
    const action = rolloutPolicy(v, rng) ?? v.legalActions[0] ?? null;
    if (!action) return 0;

    cv = applyCardAction(cv, world, seat, action);

    if (isVazaComplete(cv)) {
      const completed = completeVaza(
        cv.plays,
        cv.covered,
        world.vira,
        dealerSeat,
        RANKS,
        SUITS,
      );
      vazas.push(completed);
      cv = null;
    }
  }

  return 0;
}

// ---- Cadeia de truco após uma proposta (raise) da ação raiz -----------

function resolveTrucoChainAndPlay(
  world: World,
  vazas: readonly CompletedVaza[],
  cv: VazaInProgress | null,
  view: PlayerView,
  myTeam: Team,
  rolloutPolicy: RolloutPolicy,
  rng: Rng,
): number {
  let pendingTeam: Team = myTeam;
  let pendingValue = nextTrucoLevel(view.trucoValue);

  for (let iterations = 0; iterations < 6; iterations++) {
    const responderTeam: Team = pendingTeam === 0 ? 1 : 0;
    const responderSeat = seatForTeam(responderTeam);
    const v = buildTrucoView(
      responderSeat,
      world,
      vazas,
      cv,
      view.scores,
      view.trucoValue,
      pendingTeam,
      pendingValue,
    );
    const resp = rolloutPolicy(v, rng);

    if (!resp || resp.type !== "truco" || resp.action === "accept") {
      return playOutVazas(
        world,
        vazas,
        cv,
        pendingValue,
        view.scores,
        myTeam,
        rolloutPolicy,
        rng,
      );
    }
    if (resp.action === "run") {
      const tentos = previousTrucoLevel(pendingValue);
      return pendingTeam === myTeam ? tentos : -tentos;
    }

    const nxt = nextTrucoLevel(pendingValue);
    if (nxt === pendingValue) {
      return playOutVazas(
        world,
        vazas,
        cv,
        pendingValue,
        view.scores,
        myTeam,
        rolloutPolicy,
        rng,
      );
    }
    pendingTeam = responderTeam;
    pendingValue = nxt;
  }

  return playOutVazas(
    world,
    vazas,
    cv,
    pendingValue,
    view.scores,
    myTeam,
    rolloutPolicy,
    rng,
  );
}

// ---- Simula a ação candidata + resto da mão num mundo determinizado --

function simulateAction(
  view: PlayerView,
  world: World,
  action: Action,
  myTeam: Team,
  rolloutPolicy: RolloutPolicy,
  rng: Rng,
): number {
  const vazas: CompletedVaza[] = [...view.completedVazas];
  let cv = view.currentVaza;
  const dealerSeat = world.dealerSeat;

  if (action.type === "elevenDecision") {
    // "run" é tratado por atalho determinístico; aqui só "play" chega.
    cv = startVaza(dealerSeat);
    return playOutVazas(
      world,
      vazas,
      cv,
      3,
      view.scores,
      myTeam,
      rolloutPolicy,
      rng,
    );
  }

  if (action.type === "truco") {
    if (action.action === "accept") {
      const tv = view.trucoPendingValue ?? view.trucoValue;
      return playOutVazas(
        world,
        vazas,
        cv,
        tv,
        view.scores,
        myTeam,
        rolloutPolicy,
        rng,
      );
    }
    if (action.action === "raise") {
      return resolveTrucoChainAndPlay(
        world,
        vazas,
        cv,
        view,
        myTeam,
        rolloutPolicy,
        rng,
      );
    }
    // "run" já tratado por atalho.
    return 0;
  }

  if (action.type === "surrender") return -view.trucoValue;

  // playCard / playHiddenCard
  if (!cv) {
    const starter =
      vazas.length === 0
        ? dealerSeat
        : nextVazaStarter(vazas[vazas.length - 1]!, dealerSeat);
    cv = startVaza(starter);
  }
  cv = applyCardAction(cv, world, view.mySeat, action);

  if (isVazaComplete(cv)) {
    const completed = completeVaza(
      cv.plays,
      cv.covered,
      world.vira,
      dealerSeat,
      RANKS,
      SUITS,
    );
    vazas.push(completed);
    cv = null;
  }

  return playOutVazas(
    world,
    vazas,
    cv,
    view.trucoValue,
    view.scores,
    myTeam,
    rolloutPolicy,
    rng,
  );
}
