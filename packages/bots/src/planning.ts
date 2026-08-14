/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Planning – Planejamento curto de vazas (rota de vitória da mão)    */
/*  Avalia um score de rota para cada carta candidata (não é P(win)).  */
/* ------------------------------------------------------------------ */

import {
  DECK_SIZE,
  RANKS,
  SUITS,
  TEAMS,
  compareCards,
  partialVazaLeader,
  resolveHandWinner,
} from "@trucoviski/engine";
import type {
  Card,
  CompletedVaza,
  PlayerView,
  Seat,
  Team,
} from "@trucoviski/engine";
import {
  cardKey,
  collectSeenCards,
  equalCardsRemaining,
  getCardStrength,
  myTeam,
  partnerSeatOf,
  strongerCardsRemaining,
} from "./strength.js";
import type { HeuristicV2Features, Rng } from "./heuristic2.js";

type VazaOutcome = "won" | "lost" | "tied";

const NO_COVER: readonly [boolean, boolean, boolean, boolean] = [
  false,
  false,
  false,
  false,
];

const EMPTY_PLAYS: readonly [
  Card | null,
  Card | null,
  Card | null,
  Card | null,
] = [null, null, null, null];

/** Empate residual em vazas futuras ainda não observadas na mesa. */
export const FUTURE_VAZA_TIE_P = 0.04;

/**
 * Probabilidade de pelo menos um oponente possuir carta mais forte que a nossa,
 * dados `stronger` cartas mais fortes não vistas e `numCards` cartas na mão dos oponentes.
 */
export function probHasStronger(
  stronger: number,
  unseenTotal: number,
  numCards: number,
): number {
  return 1 - hypergeomNone(stronger, unseenTotal, numCards);
}

/** P(0 cartas de `special` em `draws` retiradas de `total`). */
function hypergeomNone(special: number, total: number, draws: number): number {
  if (draws <= 0 || total <= 0 || special <= 0) return 1;
  const other = total - special;
  if (other < draws) return 0;
  let p = 1;
  for (let i = 0; i < draws; i++) {
    p *= (other - i) / (total - i);
  }
  return Math.max(0, Math.min(1, p));
}

/**
 * P(vaza) contra `numCards` cartas ainda não vistas, dado o líder atual.
 * Empate só existe entre não-manilhas de mesmo rank (`equal`).
 */
function remainingWinLoseTie(
  stronger: number,
  equal: number,
  unseenTotal: number,
  numCards: number,
): { pWin: number; pLose: number; pTie: number } {
  const pNoStronger = hypergeomNone(stronger, unseenTotal, numCards);
  const pAllWeaker = hypergeomNone(stronger + equal, unseenTotal, numCards);
  const pLose = 1 - pNoStronger;
  const pTie = Math.max(0, pNoStronger - pAllWeaker);
  const pWin = Math.max(0, 1 - pLose - pTie);
  return { pWin, pLose, pTie };
}

/** Cartas do baralho ainda não observadas, sem contar duplicatas. */
export function countUnseenCards(seen: readonly Card[]): number {
  const unique = new Set<string>();
  for (const c of seen) unique.add(cardKey(c));
  return Math.max(0, DECK_SIZE - unique.size);
}

/**
 * Decompõe P(vencer a vaza) e P(empate) em uma distribuição que soma 1.
 * `rawWin` é P(vencer | não empatar).
 */
export function splitWinLoseTie(
  rawWin: number,
  pTie: number,
): { pWin: number; pLose: number; pTie: number } {
  const tie = Math.max(0, Math.min(1, pTie));
  const rest = 1 - tie;
  const win = Math.max(0, Math.min(1, rawWin));
  return { pWin: win * rest, pLose: (1 - win) * rest, pTie: tie };
}

function probFutureCardWin(
  card: Card,
  fVazaIndex: number,
  vira: Card,
  seen: readonly Card[],
  unseenTotal: number,
): number {
  const cardsInFuture = Math.max(1, 3 - fVazaIndex);
  const stronger = strongerCardsRemaining(card, vira, seen);
  const pOppBeats = probHasStronger(stronger, unseenTotal, 2 * cardsInFuture);
  const myStrength = getCardStrength(card, vira);
  const neededStrength = Math.max(myStrength, 8);
  const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
  const partnerStronger = strongerCardsRemaining(
    { rank: partnerThreatRank, suit: "ouros" },
    vira,
    seen,
  );
  const pPartnerHelps =
    probHasStronger(partnerStronger, unseenTotal, cardsInFuture) * 0.35;
  return Math.max(0, Math.min(1, 1 - pOppBeats + pOppBeats * pPartnerHelps));
}

function seatStillToPlay(view: PlayerView, seat: Seat): boolean {
  const vaza = view.currentVaza;
  if (!vaza) return true;
  return vaza.plays[seat] === null && vaza.covered[seat] !== true;
}

function remainingSeatsAfter(view: PlayerView, mySeat: Seat): Seat[] {
  return [1, 2, 3]
    .map((d) => ((mySeat + d) % 4) as Seat)
    .filter((s) => seatStillToPlay(view, s));
}

function vazaStub(outcome: VazaOutcome, team: Team): CompletedVaza {
  if (outcome === "tied") {
    return {
      plays: EMPTY_PLAYS,
      covered: NO_COVER,
      winner: null,
      tiedSeats: [0, 1],
    };
  }
  const winner: Seat =
    outcome === "won" ? (team === 0 ? 0 : 1) : team === 0 ? 1 : 0;
  return {
    plays: EMPTY_PLAYS,
    covered: NO_COVER,
    winner,
    tiedSeats: [],
  };
}

function teamWonHand(
  v1: VazaOutcome,
  v2: VazaOutcome,
  v3: VazaOutcome,
  team: Team,
  dealerSeat: Seat,
): boolean {
  return (
    resolveHandWinner(
      [vazaStub(v1, team), vazaStub(v2, team), vazaStub(v3, team)],
      dealerSeat,
    ) === team
  );
}

export function resolveVazaOutcomeProbabilities(
  candidateCard: Card,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
): { pWin: number; pLose: number; pTie: number } {
  const mySeat = view.mySeat;
  const team = myTeam(view);
  const vazaIndex = view.completedVazas.length;
  const cardsPerPlayer = Math.max(1, 3 - vazaIndex);
  const plays = view.currentVaza?.plays ?? EMPTY_PLAYS;

  const leader = partialVazaLeader(
    plays,
    { seat: mySeat, card: candidateCard },
    view.vira,
    view.dealerSeat,
    RANKS,
    SUITS,
  ) ?? { type: "tie" as const, card: candidateCard };

  const partnerSeat = partnerSeatOf(mySeat);
  const remainingSeats = remainingSeatsAfter(view, mySeat);
  const oppsAfter = remainingSeats.filter((s) => TEAMS[s] !== team);
  const partnerAfter = remainingSeats.some((s) => s === partnerSeat);
  const tableBest = leader.card;

  // Caso 1: Último a jogar nesta vaza
  if (remainingSeats.length === 0) {
    if (leader.type === "tie") {
      return { pWin: 0, pLose: 0, pTie: 1 };
    }
    if (leader.team === team) {
      return { pWin: 1, pLose: 0, pTie: 0 };
    }
    return { pWin: 0, pLose: 1, pTie: 0 };
  }

  // Caso 2: Nosso time está liderando a mesa
  if (leader.type === "team" && leader.team === team) {
    const numOppCards = oppsAfter.length * cardsPerPlayer;
    const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
    const equal = equalCardsRemaining(tableBest, view.vira, seen);
    const vsOpp = remainingWinLoseTie(
      stronger,
      equal,
      unseenTotal,
      numOppCards,
    );

    if (!partnerAfter) {
      return vsOpp;
    }

    const myCardStrength = getCardStrength(tableBest, view.vira);
    const neededStrength = Math.max(myCardStrength, 8);
    const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
    const partnerStronger = strongerCardsRemaining(
      { rank: partnerThreatRank, suit: "ouros" },
      view.vira,
      seen,
    );
    const pPartnerSaves =
      probHasStronger(partnerStronger, unseenTotal, cardsPerPlayer) * 0.35;
    const pLose = vsOpp.pLose * (1 - pPartnerSaves);
    const pWin = Math.min(1, vsOpp.pWin + vsOpp.pLose * pPartnerSaves);
    const pTie = Math.max(0, 1 - pWin - pLose);
    return { pWin, pLose, pTie };
  }

  // Caso 3: Oponente está liderando a mesa
  if (leader.type === "team" && leader.team !== team) {
    if (!partnerAfter) {
      return { pWin: 0, pLose: 1, pTie: 0 };
    }
    const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
    const equal = equalCardsRemaining(tableBest, view.vira, seen);
    const vsPartner = remainingWinLoseTie(
      stronger,
      equal,
      unseenTotal,
      cardsPerPlayer,
    );
    const factor = oppsAfter.length > 0 ? 0.45 : 0.85;
    const pWin = vsPartner.pLose * factor;
    const pTie = vsPartner.pTie * factor;
    const pLose = Math.max(0, 1 - pWin - pTie);
    return { pWin, pLose, pTie };
  }

  // Caso 4: Mesa empatada com oponente
  const stronger = strongerCardsRemaining(tableBest, view.vira, seen);
  const pOppBeats = probHasStronger(
    stronger,
    unseenTotal,
    oppsAfter.length * cardsPerPlayer,
  );
  if (!partnerAfter) {
    return {
      pWin: 0,
      pLose: pOppBeats,
      pTie: 1 - pOppBeats,
    };
  }

  const myCardStrength = getCardStrength(tableBest, view.vira);
  const neededStrength = Math.max(myCardStrength, 8);
  const partnerThreatRank = RANKS[Math.min(9, neededStrength)] ?? "K";
  const partnerStronger = strongerCardsRemaining(
    { rank: partnerThreatRank, suit: "ouros" },
    view.vira,
    seen,
  );
  const pPartnerSaves =
    probHasStronger(partnerStronger, unseenTotal, cardsPerPlayer) * 0.35;
  const pLose = pOppBeats * (1 - pPartnerSaves);
  const pWin = pOppBeats * pPartnerSaves;
  const pTie = Math.max(0, 1 - pLose - pWin);

  return { pWin, pLose, pTie };
}

function handWinProbVaza3(
  pWinV3: number,
  pLoseV3: number,
  pTieV3: number,
  v1: VazaOutcome,
  v2: VazaOutcome,
  team: Team,
  dealerSeat: Seat,
): number {
  const pWon = (outcome: VazaOutcome): number =>
    teamWonHand(v1, v2, outcome, team, dealerSeat) ? 1 : 0;
  return pWinV3 * pWon("won") + pLoseV3 * pWon("lost") + pTieV3 * pWon("tied");
}

function evalFutureVaza2(
  cardV2: Card,
  cardV3: Card,
  v1: VazaOutcome,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
  team: Team,
  dealerSeat: Seat,
): number {
  const p2 = splitWinLoseTie(
    probFutureCardWin(cardV2, 1, view.vira, seen, unseenTotal),
    FUTURE_VAZA_TIE_P,
  );
  const p3 = splitWinLoseTie(
    probFutureCardWin(cardV3, 2, view.vira, seen, unseenTotal),
    FUTURE_VAZA_TIE_P,
  );

  let ev = 0;

  // Se vencer a 2ª vaza:
  if (v1 === "won" || v1 === "tied") {
    ev += p2.pWin * 1.0; // Mão ganha imediatamente
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "lost",
      "won",
      team,
      dealerSeat,
    );
    ev += p2.pWin * evV3;
  }

  // Se perder a 2ª vaza:
  if (v1 === "lost" || v1 === "tied") {
    ev += p2.pLose * 0.0; // Mão perdida imediatamente
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "won",
      "lost",
      team,
      dealerSeat,
    );
    ev += p2.pLose * evV3;
  }

  // Se empatar a 2ª vaza:
  if (v1 === "won") {
    ev += p2.pTie * 1.0;
  } else if (v1 === "lost") {
    ev += p2.pTie * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "tied",
      "tied",
      team,
      dealerSeat,
    );
    ev += p2.pTie * evV3;
  }

  return ev;
}

function handWinProbVaza2(
  pWinV2: number,
  pLoseV2: number,
  pTieV2: number,
  v1: VazaOutcome,
  remCard: Card,
  view: PlayerView,
  seen: readonly Card[],
  unseenTotal: number,
  team: Team,
  dealerSeat: Seat,
): number {
  const p3 = splitWinLoseTie(
    probFutureCardWin(remCard, 2, view.vira, seen, unseenTotal),
    FUTURE_VAZA_TIE_P,
  );

  let ev = 0;

  if (v1 === "won" || v1 === "tied") {
    ev += pWinV2 * 1.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "lost",
      "won",
      team,
      dealerSeat,
    );
    ev += pWinV2 * evV3;
  }

  if (v1 === "lost" || v1 === "tied") {
    ev += pLoseV2 * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "won",
      "lost",
      team,
      dealerSeat,
    );
    ev += pLoseV2 * evV3;
  }

  if (v1 === "won") {
    ev += pTieV2 * 1.0;
  } else if (v1 === "lost") {
    ev += pTieV2 * 0.0;
  } else {
    const evV3 = handWinProbVaza3(
      p3.pWin,
      p3.pLose,
      p3.pTie,
      "tied",
      "tied",
      team,
      dealerSeat,
    );
    ev += pTieV2 * evV3;
  }

  return ev;
}

function firstVazaOutcome(view: PlayerView): VazaOutcome {
  const first = view.completedVazas[0];
  if (!first) return "tied";
  if (first.winner === null) return "tied";
  return TEAMS[first.winner] === myTeam(view) ? "won" : "lost";
}

function secondVazaOutcome(view: PlayerView): VazaOutcome {
  const second = view.completedVazas[1];
  if (!second) return "tied";
  if (second.winner === null) return "tied";
  return TEAMS[second.winner] === myTeam(view) ? "won" : "lost";
}

/**
 * Score heurístico da rota se o jogador jogar `candidateCard`.
 * Não é P(ganhar a mão): soma probabilidade estimada com bônus táticos.
 */
export function evaluateCardRoute(
  candidateCard: Card,
  view: PlayerView,
  features?: HeuristicV2Features,
): number {
  const seen = collectSeenCards(view);
  const unseenTotal = Math.max(1, countUnseenCards(seen));
  const team = myTeam(view);
  const dealerSeat = view.dealerSeat;
  const vazaIndex = view.completedVazas.length;

  let bonus = 0;

  // Bônus canga na 2ª vaza após vencer a 1ª
  if (
    features?.cangaOnPurpose &&
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "won"
  ) {
    const plays = view.currentVaza?.plays ?? EMPTY_PLAYS;
    let bestOppCard: Card | null = null;
    for (let s = 0; s < 4; s++) {
      if (TEAMS[s as Seat] !== team && plays[s]) {
        if (
          !bestOppCard ||
          compareCards(plays[s]!, bestOppCard, view.vira, RANKS, SUITS) > 0
        ) {
          bestOppCard = plays[s]!;
        }
      }
    }
    if (
      bestOppCard &&
      compareCards(candidateCard, bestOppCard, view.vira, RANKS, SUITS) === 0
    ) {
      bonus += 0.35;
    }
  }

  // Abertura com mão 100% fraca (< 8) favorece descarte da mais fraca
  if (
    vazaIndex === 0 &&
    (!view.currentVaza || view.currentVaza.plays.every((p) => p === null))
  ) {
    const maxStrength = Math.max(
      ...view.handCards.map((c) => getCardStrength(c, view.vira)),
    );
    if (maxStrength < 8) {
      const minStrength = Math.min(
        ...view.handCards.map((c) => getCardStrength(c, view.vira)),
      );
      if (getCardStrength(candidateCard, view.vira) === minStrength) {
        bonus += 0.05;
      }
    }
  }

  // Abertura na 2ª vaza após perder a 1ª: abre com a mais forte
  if (
    features?.openingProfile &&
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "lost" &&
    (!view.currentVaza || view.currentVaza.plays.every((p) => p === null))
  ) {
    const maxStrength = Math.max(
      ...view.handCards.map((c) => getCardStrength(c, view.vira)),
    );
    if (getCardStrength(candidateCard, view.vira) === maxStrength) {
      bonus += 0.15;
    }
  }

  // Na 2ª vaza após perder a 1ª: superar a carta do oponente (não a do parceiro)
  const plays = view.currentVaza?.plays ?? EMPTY_PLAYS;
  const leaderBefore = partialVazaLeader(
    plays,
    null,
    view.vira,
    view.dealerSeat,
    RANKS,
    SUITS,
  );

  if (
    vazaIndex === 1 &&
    firstVazaOutcome(view) === "lost" &&
    leaderBefore &&
    (leaderBefore.type === "tie" || leaderBefore.team !== team) &&
    compareCards(candidateCard, leaderBefore.card, view.vira, RANKS, SUITS) > 0
  ) {
    bonus += 0.2;
  }

  // Na 3ª vaza: se a carta vence a mesa, prioriza vencer com a mínima suficiente
  if (
    vazaIndex === 2 &&
    leaderBefore &&
    compareCards(candidateCard, leaderBefore.card, view.vira, RANKS, SUITS) > 0
  ) {
    bonus += 0.5;
  }

  const { pWin, pLose, pTie } = resolveVazaOutcomeProbabilities(
    candidateCard,
    view,
    seen,
    unseenTotal,
  );

  const remaining = view.handCards.filter(
    (c) => !(c.rank === candidateCard.rank && c.suit === candidateCard.suit),
  );

  if (vazaIndex === 2) {
    const v1 = firstVazaOutcome(view);
    const v2 = secondVazaOutcome(view);
    return (
      bonus + handWinProbVaza3(pWin, pLose, pTie, v1, v2, team, dealerSeat)
    );
  }

  if (vazaIndex === 1) {
    const v1 = firstVazaOutcome(view);
    const remCard =
      remaining.length > 0
        ? remaining.reduce((best, c) =>
            getCardStrength(c, view.vira) > getCardStrength(best, view.vira)
              ? c
              : best,
          )
        : candidateCard;

    return (
      bonus +
      handWinProbVaza2(
        pWin,
        pLose,
        pTie,
        v1,
        remCard,
        view,
        seen,
        unseenTotal,
        team,
        dealerSeat,
      )
    );
  }

  // vazaIndex === 0
  const r1 = remaining[0] ?? candidateCard;
  const r2 = remaining[1] ?? r1;

  const evIfWon = Math.max(
    evalFutureVaza2(r1, r2, "won", view, seen, unseenTotal, team, dealerSeat),
    evalFutureVaza2(r2, r1, "won", view, seen, unseenTotal, team, dealerSeat),
  );
  const evIfLost = Math.max(
    evalFutureVaza2(r1, r2, "lost", view, seen, unseenTotal, team, dealerSeat),
    evalFutureVaza2(r2, r1, "lost", view, seen, unseenTotal, team, dealerSeat),
  );
  const evIfTied = Math.max(
    evalFutureVaza2(r1, r2, "tied", view, seen, unseenTotal, team, dealerSeat),
    evalFutureVaza2(r2, r1, "tied", view, seen, unseenTotal, team, dealerSeat),
  );

  return bonus + pWin * evIfWon + pLose * evIfLost + pTie * evIfTied;
}

/**
 * Seleciona a melhor ação de jogar carta usando o planejamento curto de rotas.
 */
export function decidePlannedCardAction(
  view: PlayerView,
  playCardActions: readonly { type: "playCard"; card: Card }[],
  features: HeuristicV2Features,
  rng?: Rng,
): { type: "playCard"; card: Card } | null {
  if (playCardActions.length === 0) return null;
  if (playCardActions.length === 1) return playCardActions[0]!;

  let bestEV = -1;
  const scored: Array<{
    action: { type: "playCard"; card: Card };
    ev: number;
    strength: number;
  }> = [];

  for (const action of playCardActions) {
    const ev = evaluateCardRoute(action.card, view, features);
    const strength = getCardStrength(action.card, view.vira);
    scored.push({ action, ev, strength });
    if (ev > bestEV) bestEV = ev;
  }

  // Candidatos com EV próximo ao máximo (tolerância na 3ª vaza para mínima suficiente)
  const tolerance = view.completedVazas.length === 2 ? 0.6 : 0.005;
  const topCandidates = scored.filter((s) => s.ev >= bestEV - tolerance);
  if (topCandidates.length === 0) {
    return playCardActions[0] ?? null;
  }
  if (topCandidates.length === 1) {
    return topCandidates[0]!.action;
  }

  // Entre candidatos com EV equivalente, prefere economizar força (carta mais fraca)
  const minStrength = Math.min(...topCandidates.map((c) => c.strength));
  const tied = topCandidates.filter((c) => c.strength === minStrength);

  if (tied.length === 0) {
    return topCandidates[0]?.action ?? playCardActions[0] ?? null;
  }
  if (tied.length === 1 || !rng) {
    return tied[0]!.action;
  }

  const r = rng();
  const rawIdx =
    typeof r === "number" && !Number.isNaN(r) ? Math.floor(r * tied.length) : 0;
  const idx = Math.max(0, Math.min(tied.length - 1, rawIdx));
  return (tied[idx] ?? tied[0])!.action;
}
