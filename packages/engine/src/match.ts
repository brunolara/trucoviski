/* ------------------------------------------------------------------ */
/*  Match – orquestrador da partida com estado mutável interno         */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- engine determinístico */

import { createShuffledDeck } from "./deck.js";
import {
  completeVaza,
  dealCards,
  handPhase,
  isVazaComplete,
  nextVazaStarter,
  playInVaza,
  startVaza,
  viraIndex,
} from "./hand.js";
import { createPRNG, PRNG_VERSION } from "./prng.js";
import type {
  Action,
  ActionResult,
  Card,
  CompletedVaza,
  GameEvent,
  HandState,
  MatchMetadata,
  MatchPhase,
  MatchState,
  MutableHandState,
  PlayerView,
  RuleSet,
  Seat,
  Team,
  VazaInProgress,
} from "./types.js";
import { TEAMS } from "./types.js";

// ---- Estado interno mutável -----------------------------------------

interface Internal {
  phase: MatchPhase;
  handNumber: number;
  dealerSeat: Seat;
  scores: [number, number];
  hand: MutableHandState | null;
  ruleset: RuleSet;
  seed: number;
  rng: ReturnType<typeof createPRNG>;
}

// ---- API pública ----------------------------------------------------

export function createMatch(
  ruleset: RuleSet,
  seed: number,
): {
  state: () => MatchState;
  metadata: MatchMetadata;
  playerView: (seat: Seat) => PlayerView;
  dispatch: (seat: Seat, action: Action) => ActionResult;
} {
  const rng = createPRNG(seed);
  const m: Internal = {
    phase: "dealing",
    handNumber: 0,
    dealerSeat: 0,
    scores: [0, 0],
    hand: null,
    ruleset,
    seed,
    rng,
  };

  startNextHand(m);

  function state(): MatchState {
    return {
      phase: m.phase,
      handNumber: m.handNumber,
      dealerSeat: m.dealerSeat,
      scores: [...m.scores] as [number, number],
      hand: m.hand ? freezeHand(m.hand) : null,
    };
  }

  const meta: MatchMetadata = {
    rulesetName: ruleset.name,
    rulesetVersion: ruleset.version,
    prngVersion: PRNG_VERSION,
    seed,
  };

  function playerView(seat: Seat): PlayerView {
    return computePlayerView(m, seat);
  }

  function dispatch(seat: Seat, action: Action): ActionResult {
    if (m.phase === "matchFinished") {
      return { success: false, error: "matchFinished" };
    }
    if (!m.hand) {
      return { success: false, error: "invalidPhase" };
    }

    const result = doAction(m, seat, action);
    if (!result.success) return result;

    const allEvents: GameEvent[] = [...result.events];

    // Auto-transições: handFinished → nova mão → matchFinished?
    while (m.phase === "handFinished") {
      const winner = checkMatchWinner(m.scores, m.ruleset);
      if (winner !== null) {
        m.phase = "matchFinished";
        m.hand = null;
        allEvents.push({
          type: "matchFinished",
          winnerTeam: winner,
          finalScores: [...m.scores] as [number, number],
        });
        break;
      }

      startNextHand(m);
      allEvents.push({
        type: "handStarted",
        handNumber: m.handNumber,
        dealerSeat: m.dealerSeat,
        vira: deepCopyCard(m.hand!.vira),
      });
    }

    return { success: true, events: allEvents };
  }

  return { state, metadata: meta, playerView, dispatch };
}

// ---- Iniciar próxima mão --------------------------------------------

function startNextHand(m: Internal): void {
  m.handNumber++;
  // Rotaciona o dealer apenas se não for a primeira mão
  if (m.handNumber > 1) {
    m.dealerSeat = ((m.dealerSeat + 1) % 4) as Seat;
  }

  const deck = createShuffledDeck(m.rng);
  m.hand = buildNewHand(m.ruleset, deck, m.dealerSeat, m.scores);

  const hp = handPhase(m.hand);
  m.phase = hp === "elevenDecision" ? "elevenDecision" : "playing";
}

function buildNewHand(
  ruleset: RuleSet,
  deck: Card[],
  dealerSeat: Seat,
  scores: readonly [number, number],
): MutableHandState {
  const rawCards = dealCards(deck, dealerSeat, ruleset.cardsPerPlayer);
  const cards: [Card[], Card[], Card[], Card[]] = [
    [...rawCards[0]],
    [...rawCards[1]],
    [...rawCards[2]],
    [...rawCards[3]],
  ];
  const vi = viraIndex(ruleset.cardsPerPlayer);
  const vira = deck[vi]!;

  const isElevenHand =
    (scores[0] === ruleset.elevenThreshold &&
      scores[1] !== ruleset.elevenThreshold) ||
    (scores[1] === ruleset.elevenThreshold &&
      scores[0] !== ruleset.elevenThreshold);
  const isFerro =
    scores[0] === ruleset.elevenThreshold &&
    scores[1] === ruleset.elevenThreshold;

  return {
    vira,
    cards,
    completedVazas: [],
    currentVaza: isFerro ? startVaza(dealerSeat) : null,
    trucoValue: isElevenHand || isFerro ? 3 : 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    trucoLastRaiser: null,
    isElevenHand: isElevenHand && !isFerro,
    isFerro,
    elevenDecision: null,
    dealerSeat,
    nextStarter: dealerSeat,
    finished: false,
  };
}

// ---- Aplicar ação ---------------------------------------------------

function doAction(m: Internal, seat: Seat, action: Action): ActionResult {
  const h = m.hand!;
  const phase = handPhase(h);

  if (phase === "elevenDecision") {
    return doElevenDecision(m, h, seat, action);
  }

  if (phase === "playing") {
    if (action.type === "playCard") {
      if (h.isFerro) return { success: false, error: "invalidPhase" };
      return doPlayCard(m, h, seat, action.card);
    }
    if (action.type === "playHiddenCard") {
      if (!h.isFerro) return { success: false, error: "invalidPhase" };
      return doPlayHiddenCard(m, h, seat, action.cardIndex);
    }
    if (action.type === "truco") return doTruco(m, h, seat, action.action);
    return { success: false, error: "invalidPhase" };
  }

  return { success: false, error: "invalidPhase" };
}

// ---- Decisão de onze ------------------------------------------------

function doElevenDecision(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
  action: Action,
): ActionResult {
  if (action.type !== "elevenDecision") {
    return { success: false, error: "invalidPhase" };
  }

  const elevenTeam: Team = m.scores[0] === 11 ? 0 : 1;
  if (TEAMS[seat] !== elevenTeam) {
    return { success: false, error: "notYourDecision" };
  }

  const events: GameEvent[] = [
    { type: "elevenDecided", decision: action.decision },
  ];

  if (action.decision === "run") {
    const opponent: Team = elevenTeam === 0 ? 1 : 0;
    h.finished = true;
    h.elevenDecision = "run";
    m.phase = "handFinished";
    m.scores[opponent] = m.scores[opponent]! + 1;
    events.push({
      type: "handFinished",
      winnerTeam: opponent,
      tentos: 1,
      reason: "run",
    });
    return { success: true, events };
  }

  // play → hand at value 3, no truco
  h.trucoValue = 3;
  h.elevenDecision = "play";
  h.currentVaza = startVaza(h.dealerSeat);
  m.phase = "playing";
  return { success: true, events };
}

// ---- Jogar carta ----------------------------------------------------

function doPlayCard(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
  card: Card,
): ActionResult {
  if (h.trucoPendingTeam !== null) {
    return { success: false, error: "notYourTurn" };
  }

  const whoseTurn = h.currentVaza ? h.currentVaza.currentSeat : h.nextStarter;
  if (whoseTurn !== seat) {
    return { success: false, error: "notYourTurn" };
  }

  const seatCards = h.cards[seat];
  const idx = seatCards.findIndex(
    (c) => c.suit === card.suit && c.rank === card.rank,
  );
  if (idx === -1) {
    return { success: false, error: "cardNotInHand" };
  }

  return executePlayCard(m, h, seat, seatCards, idx);
}

/** Jogar carta por índice (ferro – cardIndex opaco, carta nunca exposta ao cliente). */
function doPlayHiddenCard(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
  cardIndex: number,
): ActionResult {
  if (h.trucoPendingTeam !== null) {
    return { success: false, error: "notYourTurn" };
  }

  const whoseTurn = h.currentVaza ? h.currentVaza.currentSeat : h.nextStarter;
  if (whoseTurn !== seat) {
    return { success: false, error: "notYourTurn" };
  }

  const seatCards = h.cards[seat];
  if (cardIndex < 0 || cardIndex >= seatCards.length) {
    return { success: false, error: "invalidCardIndex" };
  }

  return executePlayCard(m, h, seat, seatCards, cardIndex);
}

function executePlayCard(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
  seatCards: Card[],
  idx: number,
): ActionResult {
  const card = seatCards[idx]!;

  if (!h.currentVaza) {
    h.currentVaza = startVaza(h.nextStarter);
  }

  seatCards.splice(idx, 1);

  const newVaza = playInVaza(h.currentVaza, seat, deepCopyCard(card));
  h.currentVaza = newVaza;

  const events: GameEvent[] = [
    { type: "cardPlayed", seat, card: deepCopyCard(card) },
  ];

  if (isVazaComplete(newVaza)) {
    const vazaNumber = h.completedVazas.length + 1;
    const completed = completeVaza(
      newVaza.plays,
      h.vira,
      h.dealerSeat,
      m.ruleset.rankOrder,
      m.ruleset.suitOrder,
    );

    h.completedVazas.push(completed);
    h.currentVaza = null;
    h.nextStarter = nextVazaStarter(completed);

    const frozenPlays = newVaza.plays.map(deepCopyCard) as [
      Card,
      Card,
      Card,
      Card,
    ];

    events.push({
      type: "vazaCompleted",
      vazaNumber,
      plays: frozenPlays,
      winner: completed.winner,
    });

    const resolution = checkHandResolved(h);
    if (resolution !== null) {
      h.finished = true;
      m.phase = "handFinished";
      m.scores[resolution.winner] =
        m.scores[resolution.winner]! + resolution.tentos;

      events.push({
        type: "handFinished",
        winnerTeam: resolution.winner,
        tentos: resolution.tentos,
        reason: "vazas",
      });
    }
  }

  return { success: true, events };
}

// ---- Truco ----------------------------------------------------------

function doTruco(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
  trucoAction: "raise" | "accept" | "run",
): ActionResult {
  if (h.isElevenHand || h.isFerro) {
    return { success: false, error: "trucoForbidden" };
  }

  const maxVal = lastTrucoLevel(m.ruleset);

  if (trucoAction === "raise") {
    // Contra-aumento (truco pendente)
    if (h.trucoPendingTeam !== null) {
      if (h.trucoPendingTeam === TEAMS[seat]) {
        return { success: false, error: "cannotRaiseYourOwnTruco" };
      }
      const nextVal = nextTrucoLevel(h.trucoPendingValue!, m.ruleset);
      if (nextVal > maxVal || nextVal === h.trucoPendingValue) {
        return { success: false, error: "maxTrucoValue" };
      }
      h.trucoPendingValue = nextVal;
      h.trucoPendingTeam = TEAMS[seat] as Team;
      return {
        success: true,
        events: [{ type: "trucoRaised", seat, pendingValue: nextVal }],
      };
    }

    // Novo truco: alterna entre times
    if (h.trucoLastRaiser !== null && h.trucoLastRaiser === TEAMS[seat]) {
      return { success: false, error: "cannotRaiseYourOwnTruco" };
    }
    if (h.trucoValue >= maxVal) {
      return { success: false, error: "maxTrucoValue" };
    }
    const nextVal = nextTrucoLevel(h.trucoValue, m.ruleset);
    h.trucoPendingValue = nextVal;
    h.trucoPendingTeam = TEAMS[seat] as Team;
    return {
      success: true,
      events: [{ type: "trucoRaised", seat, pendingValue: nextVal }],
    };
  }

  // Accept / Run (exige pendente)
  if (h.trucoPendingTeam === null) {
    return { success: false, error: "trucoNotPending" };
  }

  if (h.trucoPendingTeam === TEAMS[seat]) {
    return { success: false, error: "cannotRaiseYourOwnTruco" };
  }

  if (trucoAction === "accept") {
    h.trucoValue = h.trucoPendingValue!;
    h.trucoLastRaiser = h.trucoPendingTeam; // quem teve o pedido aceito é o último raiser
    h.trucoPendingTeam = null;
    h.trucoPendingValue = null;
    return {
      success: true,
      events: [{ type: "trucoAccepted", value: h.trucoValue }],
    };
  }

  // Run
  if (trucoAction === "run") {
    // Quem fez o pedido pendente ganha; quem corre perde
    const winner = h.trucoPendingTeam;
    // "valor anterior ao pedido pendente"
    const tentos = previousTrucoLevel(h.trucoPendingValue!, m.ruleset);
    h.finished = true;
    m.phase = "handFinished";
    m.scores[winner] = m.scores[winner]! + tentos;
    return {
      success: true,
      events: [
        {
          type: "trucoRan",
          seat,
          winnerTeam: winner,
          tentos,
        },
        {
          type: "handFinished",
          winnerTeam: winner,
          tentos,
          reason: "run",
        },
      ],
    };
  }

  return { success: false, error: "invalidPhase" };
}

// ---- Resolução por vazas --------------------------------------------

interface HandResolution {
  winner: Team;
  tentos: number;
}

function checkHandResolved(h: MutableHandState): HandResolution | null {
  let t0 = 0;
  let t1 = 0;
  for (const v of h.completedVazas) {
    if (v.winner !== null) {
      if (TEAMS[v.winner] === 0) t0++;
      else t1++;
    }
  }

  const n = h.completedVazas.length;

  // 3 vazas → sempre resolve
  if (n >= 3) {
    if (t0 > t1) return { winner: 0, tentos: h.trucoValue };
    if (t1 > t0) return { winner: 1, tentos: h.trucoValue };
    // canga tripla → time do mão
    return { winner: TEAMS[h.dealerSeat], tentos: h.trucoValue };
  }

  // 2 vazas → resolve se um time já venceu e o outro não
  if (n === 2) {
    if (t0 >= 1 && t1 === 0) return { winner: 0, tentos: h.trucoValue };
    if (t1 >= 1 && t0 === 0) return { winner: 1, tentos: h.trucoValue };
    // 1-1 ou 0-0 com duas cangas → precisa da 3ª
    return null;
  }

  // 1 vaza → nunca resolve
  return null;
}

// ---- Fim de partida -------------------------------------------------

function checkMatchWinner(
  scores: readonly [number, number],
  ruleset: RuleSet,
): Team | null {
  if (scores[0] >= ruleset.winThreshold) return 0;
  if (scores[1] >= ruleset.winThreshold) return 1;
  return null;
}

// ---- Auxiliares de truco --------------------------------------------

function nextTrucoLevel(current: number, ruleset: RuleSet): number {
  const seq = ruleset.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx === -1 || idx === seq.length - 1) return current;
  return seq[idx + 1]!;
}

function lastTrucoLevel(ruleset: RuleSet): number {
  return ruleset.trucoSequence[ruleset.trucoSequence.length - 1]!;
}

function previousTrucoLevel(current: number, ruleset: RuleSet): number {
  const seq = ruleset.trucoSequence;
  const idx = seq.indexOf(current);
  if (idx <= 0) return seq[0]!;
  return seq[idx - 1]!;
}

// ---- PlayerView ----------------------------------------------------

function computePlayerView(m: Internal, seat: Seat): PlayerView {
  const h = m.hand;
  if (!h) {
    return {
      handNumber: m.handNumber,
      handCards: [],
      vira: { suit: "paus", rank: "4" },
      completedVazas: [],
      currentVaza: null,
      scores: [...m.scores] as [number, number],
      trucoValue: 0,
      trucoPendingTeam: null,
      isElevenHand: false,
      isFerro: false,
      elevenDecision: null,
      legalActions: [],
    };
  }

  const handCards = h.isFerro ? [] : h.cards[seat].map(deepCopyCard);
  const partnerCards =
    h.isElevenHand && !h.isFerro && TEAMS[seat] === (m.scores[0] === 11 ? 0 : 1)
      ? h.cards[((seat + 2) % 4) as Seat].map(deepCopyCard)
      : undefined;
  const legal = computeLegalActions(m, h, seat);

  return {
    handNumber: m.handNumber,
    handCards,
    partnerCards,
    vira: deepCopyCard(h.vira),
    completedVazas: h.completedVazas.map((v): CompletedVaza => ({
      plays: v.plays.map(deepCopyCard) as [Card, Card, Card, Card],
      winner: v.winner,
      tiedSeats: [...v.tiedSeats],
    })),
    currentVaza: h.currentVaza
      ? {
          plays: [...h.currentVaza.plays] as [
            Card | null,
            Card | null,
            Card | null,
            Card | null,
          ],
          currentSeat: h.currentVaza.currentSeat,
        }
      : null,
    scores: [...m.scores] as [number, number],
    trucoValue: h.trucoValue,
    trucoPendingTeam: h.trucoPendingTeam,
    isElevenHand: h.isElevenHand,
    isFerro: h.isFerro,
    elevenDecision: h.elevenDecision,
    legalActions: legal,
  };
}

// ---- Ações legais ---------------------------------------------------

function computeLegalActions(
  m: Internal,
  h: MutableHandState,
  seat: Seat,
): Action[] {
  const actions: Action[] = [];
  const phase = handPhase(h);

  if (phase === "elevenDecision") {
    const elevenTeam: Team = m.scores[0] === 11 ? 0 : 1;
    if (TEAMS[seat] === elevenTeam) {
      actions.push(
        { type: "elevenDecision", decision: "play" },
        { type: "elevenDecision", decision: "run" },
      );
    }
    return actions;
  }

  if (phase === "finished") return [];

  // Truco pendente → respostas do time oposto
  if (h.trucoPendingTeam !== null) {
    if (h.trucoPendingTeam !== TEAMS[seat]) {
      actions.push(
        { type: "truco", action: "accept" },
        { type: "truco", action: "run" },
      );
      const pendVal = h.trucoPendingValue!;
      const nextVal = nextTrucoLevel(pendVal, m.ruleset);
      if (nextVal <= lastTrucoLevel(m.ruleset) && nextVal > pendVal) {
        actions.push({ type: "truco", action: "raise" });
      }
    }
    return actions;
  }

  // Jogar carta (se for a vez, ou se for o próximo a abrir vaza)
  if (h.isFerro) {
    // Ferro: nunca expõe as cartas — usa índice opaco.
    if (h.currentVaza) {
      if (h.currentVaza.currentSeat === seat) {
        for (let i = 0; i < h.cards[seat].length; i++) {
          actions.push({ type: "playHiddenCard", cardIndex: i });
        }
      }
    } else if (h.nextStarter === seat) {
      for (let i = 0; i < h.cards[seat].length; i++) {
        actions.push({ type: "playHiddenCard", cardIndex: i });
      }
    }
  } else {
    if (h.currentVaza) {
      if (h.currentVaza.currentSeat === seat) {
        for (const card of h.cards[seat]) {
          actions.push({ type: "playCard", card });
        }
      }
    } else if (h.nextStarter === seat) {
      for (const card of h.cards[seat]) {
        actions.push({ type: "playCard", card });
      }
    }
  }

  // Iniciar truco (se permitido)
  if (!h.isElevenHand && !h.isFerro) {
    if (
      h.trucoValue < lastTrucoLevel(m.ruleset) &&
      h.trucoLastRaiser !== TEAMS[seat]
    ) {
      actions.push({ type: "truco", action: "raise" });
    }
  }

  return actions;
}

// ---- Freeze --------------------------------------------------------

function freezeHand(h: MutableHandState): HandState {
  return {
    vira: deepCopyCard(h.vira),
    cards: h.cards.map((c) => c.map(deepCopyCard)) as unknown as [
      readonly Card[],
      readonly Card[],
      readonly Card[],
      readonly Card[],
    ],
    completedVazas: h.completedVazas.map((v): CompletedVaza => ({
      plays: v.plays.map(deepCopyCard) as [Card, Card, Card, Card],
      winner: v.winner,
      tiedSeats: [...v.tiedSeats],
    })),
    currentVaza: h.currentVaza
      ? ({
          plays: [...h.currentVaza.plays] as [
            Card | null,
            Card | null,
            Card | null,
            Card | null,
          ],
          currentSeat: h.currentVaza.currentSeat,
        } satisfies VazaInProgress)
      : null,
    trucoValue: h.trucoValue,
    trucoPendingTeam: h.trucoPendingTeam,
    trucoPendingValue: h.trucoPendingValue,
    isElevenHand: h.isElevenHand,
    isFerro: h.isFerro,
    elevenDecision: h.elevenDecision,
    dealerSeat: h.dealerSeat,
    nextStarter: h.nextStarter,
    finished: h.finished,
  };
}

// ---- Deep copy util -------------------------------------------------

function deepCopyCard(c: Card): Card {
  return { suit: c.suit, rank: c.rank };
}
