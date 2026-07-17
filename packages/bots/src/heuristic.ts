/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* ------------------------------------------------------------------ */
/*  Heuristic Bot – estratégia heurística de jogo para IA do servidor */
/* ------------------------------------------------------------------ */

import { RANKS, SUITS, compareCards, TEAMS } from "@trucoviski/engine";
import type { Card, PlayerView, Action, Seat } from "@trucoviski/engine";

function getCardStrength(card: Card, vira: Card): number {
  const viraIdx = RANKS.indexOf(vira.rank);
  if (viraIdx === -1) return 0;
  const manilhaRank = RANKS[(viraIdx + 1) % RANKS.length]!;
  if (card.rank === manilhaRank) {
    if (card.suit === "ouros") return 10;
    if (card.suit === "espadas") return 11;
    if (card.suit === "copas") return 12;
    if (card.suit === "paus") return 13;
  }
  return RANKS.indexOf(card.rank);
}

export function decideHeuristicAction(view: PlayerView): Action | null {
  const actions = view.legalActions;
  if (actions.length === 0) return null;

  // 1. Decisão de mão de onze
  const elevenActions = actions.filter((a) => a.type === "elevenDecision");
  if (elevenActions.length > 0) {
    const myMax =
      view.handCards.length > 0
        ? Math.max(...view.handCards.map((c) => getCardStrength(c, view.vira)))
        : 0;
    const partnerMax =
      view.partnerCards && view.partnerCards.length > 0
        ? Math.max(
            ...view.partnerCards.map((c) => getCardStrength(c, view.vira)),
          )
        : 0;

    const teamMax = Math.max(myMax, partnerMax);
    const allCards = [...view.handCards, ...(view.partnerCards ?? [])];
    const goodCardsCount = allCards.filter(
      (c) => getCardStrength(c, view.vira) >= 8,
    ).length;

    const shouldPlay =
      teamMax >= 11 || goodCardsCount >= 3 || (myMax >= 9 && partnerMax >= 8);
    const decision = shouldPlay ? "play" : "run";

    const selected = elevenActions.find(
      (a) => (a as { decision: string }).decision === decision,
    );
    if (selected) return selected;
  }

  // 2. Decisão de responder a Truco (aceitar/correr/aumentar)
  const trucoResponses = actions.filter(
    (a) =>
      a.type === "truco" &&
      ((a as { action: string }).action === "accept" ||
        (a as { action: string }).action === "run"),
  );
  if (trucoResponses.length > 0) {
    const myMax =
      view.handCards.length > 0
        ? Math.max(...view.handCards.map((c) => getCardStrength(c, view.vira)))
        : 0;

    let wonFirstVaza = false;
    if (view.currentVaza) {
      const mySeat = view.currentVaza.currentSeat;
      const myTeam = TEAMS[mySeat];
      const firstVaza = view.completedVazas[0];
      if (firstVaza && firstVaza.winner !== null) {
        wonFirstVaza = TEAMS[firstVaza.winner] === myTeam;
      }
    }

    const canRaise = actions.some(
      (a) => a.type === "truco" && (a as { action: string }).action === "raise",
    );
    if (myMax >= 12 && canRaise) {
      const raiseAction = actions.find(
        (a) =>
          a.type === "truco" && (a as { action: string }).action === "raise",
      );
      if (raiseAction) return raiseAction;
    }

    const shouldAccept =
      myMax >= 8 ||
      wonFirstVaza ||
      (view.completedVazas.length === 0 && myMax >= 7);
    const decision = shouldAccept ? "accept" : "run";
    const selected = trucoResponses.find(
      (a) => (a as { action: string }).action === decision,
    );
    return selected ?? null;
  }

  // 3. Decisão de propor Truco (raise)
  const trucoProposals = actions.filter(
    (a) => a.type === "truco" && (a as { action: string }).action === "raise",
  );
  if (trucoProposals.length > 0) {
    const myMax =
      view.handCards.length > 0
        ? Math.max(...view.handCards.map((c) => getCardStrength(c, view.vira)))
        : 0;

    let wonFirstVaza = false;
    if (view.currentVaza) {
      const mySeat = view.currentVaza.currentSeat;
      const myTeam = TEAMS[mySeat];
      const firstVaza = view.completedVazas[0];
      if (firstVaza && firstVaza.winner !== null) {
        wonFirstVaza = TEAMS[firstVaza.winner] === myTeam;
      }
    }

    const shouldRaise = myMax >= 10 || (myMax >= 8 && wonFirstVaza);
    if (shouldRaise) {
      return trucoProposals[0] ?? null;
    }
  }

  // 4. Decisão de jogar carta (playCard)
  const playCardActions = actions.filter((a) => a.type === "playCard") as {
    type: "playCard";
    card: Card;
  }[];
  if (playCardActions.length > 0) {
    const mySeat = view.currentVaza?.currentSeat;
    const isOpening =
      !view.currentVaza || view.currentVaza.plays.every((p) => p === null);

    if (isOpening || mySeat === undefined) {
      let bestAction = playCardActions[0]!;
      let minStr = getCardStrength(bestAction.card, view.vira);
      for (const act of playCardActions) {
        const str = getCardStrength(act.card, view.vira);
        if (str < minStr) {
          minStr = str;
          bestAction = act;
        }
      }
      return bestAction;
    }

    const plays = view.currentVaza.plays;
    const partnerSeat = ((mySeat + 2) % 4) as Seat;

    let bestCard: Card | null = null;
    let bestSeat: number | null = null;

    for (let i = 0; i < 4; i++) {
      const p = plays[i];
      if (p) {
        if (
          !bestCard ||
          compareCards(p, bestCard, view.vira, RANKS, SUITS) > 0
        ) {
          bestCard = p;
          bestSeat = i;
        }
      }
    }

    const partnerIsWinning = bestSeat === partnerSeat;
    const isLastToPlay = plays.filter((p) => p !== null).length === 3;

    if (partnerIsWinning && isLastToPlay) {
      let bestAction = playCardActions[0]!;
      let minStr = getCardStrength(bestAction.card, view.vira);
      for (const act of playCardActions) {
        const str = getCardStrength(act.card, view.vira);
        if (str < minStr) {
          minStr = str;
          bestAction = act;
        }
      }
      return bestAction;
    }

    if (bestCard) {
      const winningActions = playCardActions.filter(
        (a) => compareCards(a.card, bestCard!, view.vira, RANKS, SUITS) > 0,
      );

      if (winningActions.length > 0) {
        let bestAction = winningActions[0]!;
        let minStr = getCardStrength(bestAction.card, view.vira);
        for (const act of winningActions) {
          const str = getCardStrength(act.card, view.vira);
          if (str < minStr) {
            minStr = str;
            bestAction = act;
          }
        }
        return bestAction;
      }
    }

    let bestAction = playCardActions[0]!;
    let minStr = getCardStrength(bestAction.card, view.vira);
    for (const act of playCardActions) {
      const str = getCardStrength(act.card, view.vira);
      if (str < minStr) {
        minStr = str;
        bestAction = act;
      }
    }
    return bestAction;
  }

  // 5. Ferro: playHiddenCard (cartas cobertas)
  const playHiddenActions = actions.filter((a) => a.type === "playHiddenCard");
  if (playHiddenActions.length > 0) {
    return playHiddenActions[0] ?? null;
  }

  return actions[0] ?? null;
}
