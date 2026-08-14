import { describe, expect, it } from "vitest";
import type {
  Action,
  Card,
  CompletedVaza,
  PlayerView,
  Rank,
  Seat,
  Suit,
  VazaInProgress,
} from "@trucoviski/engine";
import { decideHeuristicV3Action } from "../packages/bots/src/heuristic2.js";

/** vira 4 → manilha 5 (ouros 10 … paus/zap 13). */
const VIRA: Card = { suit: "paus", rank: "4" };
const midRng = () => 0.5;

function C(rank: Rank, suit: Suit = "ouros"): Card {
  return { rank, suit };
}

function plays(
  list: readonly (Card | null)[],
): [Card | null, Card | null, Card | null, Card | null] {
  return [list[0] ?? null, list[1] ?? null, list[2] ?? null, list[3] ?? null];
}

function covered4(): readonly [boolean, boolean, boolean, boolean] {
  return [false, false, false, false];
}

function completed(
  winner: Seat | null,
  cards: readonly (Card | null)[],
): CompletedVaza {
  return {
    plays: plays(cards),
    covered: covered4(),
    winner,
    tiedSeats: winner === null ? [0, 1, 2, 3] : [],
  };
}

function inPlay(
  currentSeat: Seat,
  cards: readonly (Card | null)[],
): VazaInProgress {
  return { plays: plays(cards), covered: covered4(), currentSeat };
}

function legalCards(
  hand: readonly Card[],
  extra: readonly Action[] = [],
): Action[] {
  return [
    ...hand.map((card) => ({ type: "playCard" as const, card })),
    ...extra,
    { type: "surrender" },
  ];
}

function hiddenOf(hand: readonly Card[]): Action[] {
  return hand.map((_, cardIndex) => ({
    type: "playHiddenCard" as const,
    cardIndex,
  }));
}

function view(
  over: Partial<PlayerView> & Pick<PlayerView, "handCards" | "legalActions">,
): PlayerView {
  return {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 3,
    vira: VIRA,
    completedVazas: [],
    currentVaza: null,
    scores: [0, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    ...over,
  };
}

type Tatica = {
  readonly id: string;
  readonly categoria: string;
  readonly view: PlayerView;
  readonly esperado: readonly Action[];
  readonly pred?: (got: Action | null) => boolean;
};

function play(card: Card): Action {
  return { type: "playCard", card };
}

function hide(cardIndex: number): Action {
  return { type: "playHiddenCard", cardIndex };
}

function truco(action: "accept" | "run" | "raise"): Action {
  return { type: "truco", action };
}

function eleven(decision: "play" | "run"): Action {
  return { type: "elevenDecision", decision };
}

function actionEq(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "playCard" && b.type === "playCard") {
    return a.card.rank === b.card.rank && a.card.suit === b.card.suit;
  }
  if (a.type === "playHiddenCard" && b.type === "playHiddenCard") {
    return a.cardIndex === b.cardIndex;
  }
  if (a.type === "truco" && b.type === "truco") return a.action === b.action;
  if (a.type === "elevenDecision" && b.type === "elevenDecision") {
    return a.decision === b.decision;
  }
  return a.type === b.type;
}

function hits(t: Tatica, rng: () => number = midRng): boolean {
  const got = decideHeuristicV3Action(t.view, rng);
  if (t.pred) return t.pred(got);
  return t.esperado.some((e) => got !== null && actionEq(got, e));
}

const ZAP = C("5", "paus");
const COPAS = C("5", "copas");
const ESPADAS = C("5", "espadas");
const OUROS_M = C("5", "ouros");
const TRES = C("3", "copas");
const DOIS = C("2", "espadas");
const AS = C("A", "paus");
const SETE = C("7", "ouros");
const QUATRO = C("4", "ouros");
const SEIS = C("6", "copas");
const Q = C("Q", "espadas");
const J = C("J", "paus");
const K = C("K", "ouros");

function firstVaza(winner: Seat): CompletedVaza {
  return completed(winner, [
    C("6", "paus"),
    C("7", "copas"),
    C("Q", "ouros"),
    C("J", "espadas"),
  ]);
}

const CASOS: Tatica[] = [
  // ---- abertura --------------------------------------------------------
  {
    id: "abertura-fraca-1",
    categoria: "abertura",
    view: view({
      handCards: [QUATRO, SEIS, SETE],
      legalActions: legalCards([QUATRO, SEIS, SETE]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "abertura-fraca-2",
    categoria: "abertura",
    view: view({
      handCards: [C("4", "copas"), Q, J],
      legalActions: legalCards([C("4", "copas"), Q, J]),
    }),
    esperado: [play(C("4", "copas"))],
  },
  {
    id: "abertura-fraca-3",
    categoria: "abertura",
    view: view({
      handCards: [C("4", "espadas"), C("6", "paus"), K],
      legalActions: legalCards([C("4", "espadas"), C("6", "paus"), K]),
    }),
    esperado: [play(C("4", "espadas"))],
  },
  {
    id: "abertura-duas-manilhas-1",
    categoria: "abertura",
    view: view({
      handCards: [QUATRO, COPAS, ZAP],
      legalActions: legalCards([QUATRO, COPAS, ZAP]),
    }),
    esperado: [play(COPAS), play(ZAP)],
  },
  {
    id: "abertura-duas-manilhas-2",
    categoria: "abertura",
    view: view({
      handCards: [SEIS, ESPADAS, ZAP],
      legalActions: legalCards([SEIS, ESPADAS, ZAP]),
    }),
    esperado: [play(ESPADAS), play(ZAP)],
  },
  {
    id: "abertura-zap-lixo",
    categoria: "abertura",
    view: view({
      handCards: [QUATRO, SETE, ZAP],
      legalActions: legalCards([QUATRO, SETE, ZAP]),
    }),
    esperado: [play(ZAP)],
  },
  {
    id: "abertura-2a-perdeu-1a-1",
    categoria: "abertura",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1)],
      handCards: [QUATRO, SETE, TRES],
      legalActions: legalCards([QUATRO, SETE, TRES]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "abertura-2a-perdeu-1a-2",
    categoria: "abertura",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1)],
      handCards: [QUATRO, AS, DOIS],
      legalActions: legalCards([QUATRO, AS, DOIS]),
    }),
    esperado: [play(DOIS)],
  },
  {
    id: "abertura-2a-ganhou-1a",
    categoria: "abertura",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      handCards: [QUATRO, SETE, TRES],
      legalActions: legalCards([QUATRO, SETE, TRES]),
    }),
    esperado: [play(QUATRO)],
  },

  // ---- canga -----------------------------------------------------------
  {
    id: "canga-7-1",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, C("7", "copas"), null, null]),
      handCards: [C("7", "paus"), TRES],
      legalActions: legalCards([C("7", "paus"), TRES]),
    }),
    esperado: [play(C("7", "paus"))],
  },
  {
    id: "canga-q-1",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, Q, null, null]),
      handCards: [C("Q", "paus"), QUATRO],
      legalActions: legalCards([C("Q", "paus"), QUATRO]),
    }),
    esperado: [play(C("Q", "paus"))],
  },
  {
    id: "canga-a-1",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, AS, null, null]),
      handCards: [C("A", "ouros"), DOIS],
      legalActions: legalCards([C("A", "ouros"), DOIS]),
    }),
    esperado: [play(C("A", "ouros"))],
  },
  {
    id: "canga-3-1",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, TRES, null, null]),
      handCards: [C("3", "paus"), ZAP],
      legalActions: legalCards([C("3", "paus"), ZAP]),
    }),
    esperado: [play(C("3", "paus"))],
  },
  {
    id: "canga-nao-quando-perdeu-1a",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1)],
      currentVaza: inPlay(0, [null, SETE, null, null]),
      handCards: [C("7", "paus"), TRES],
      legalActions: legalCards([C("7", "paus"), TRES]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "canga-k-1",
    categoria: "canga",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, K, null, null]),
      handCards: [C("K", "paus"), J],
      legalActions: legalCards([C("K", "paus"), J]),
    }),
    esperado: [play(C("K", "paus"))],
  },

  // ---- 2ª vaza depois de ganhar a 1ª ----------------------------------
  {
    id: "segunda-min-win-1",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, SEIS, null, null]),
      handCards: [SETE, ZAP],
      legalActions: legalCards([SETE, ZAP]),
    }),
    esperado: [play(SETE)],
  },
  {
    id: "segunda-min-win-2",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, DOIS, null, null]),
      handCards: [TRES, ZAP],
      legalActions: legalCards([TRES, ZAP]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "segunda-min-win-3",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, AS, null, null]),
      handCards: [DOIS, COPAS],
      legalActions: legalCards([DOIS, COPAS]),
    }),
    esperado: [play(DOIS)],
  },
  {
    id: "segunda-ultimo-min-win",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [
        null,
        C("A", "copas"),
        C("2", "ouros"),
        C("K", "paus"),
      ]),
      handCards: [TRES, ZAP],
      legalActions: legalCards([TRES, ZAP]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "segunda-nao-ganha-descarta",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, ZAP, null, null]),
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "segunda-as-vs-k",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, K, null, null]),
      handCards: [AS, OUROS_M],
      legalActions: legalCards([AS, OUROS_M]),
    }),
    esperado: [play(AS)],
  },

  // ---- 3ª vaza decisiva -----------------------------------------------
  {
    id: "terceira-min-win-1",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0), firstVaza(1)],
      currentVaza: inPlay(0, [null, AS, null, null]),
      handCards: [DOIS, TRES],
      legalActions: legalCards([DOIS, TRES]),
    }),
    esperado: [play(DOIS)],
  },
  {
    id: "terceira-min-win-2",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1), firstVaza(0)],
      currentVaza: inPlay(0, [null, DOIS, null, null]),
      handCards: [TRES, ZAP],
      legalActions: legalCards([TRES, ZAP]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "terceira-min-win-3",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0), firstVaza(1)],
      currentVaza: inPlay(0, [null, Q, null, null]),
      handCards: [J, COPAS],
      legalActions: legalCards([J, COPAS]),
    }),
    esperado: [play(J)],
  },
  {
    id: "terceira-ultimo-min-win",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1), firstVaza(0)],
      currentVaza: inPlay(0, [null, AS, K, Q]),
      handCards: [DOIS, ESPADAS],
      legalActions: legalCards([DOIS, ESPADAS]),
    }),
    esperado: [play(DOIS)],
  },
  {
    id: "terceira-nao-ganha",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1), firstVaza(0)],
      currentVaza: inPlay(0, [null, ZAP, null, null]),
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "terceira-so-manilha-vence",
    categoria: "terceira-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1), firstVaza(0)],
      currentVaza: inPlay(0, [null, TRES, null, null]),
      handCards: [QUATRO, ZAP],
      legalActions: legalCards([QUATRO, ZAP]),
    }),
    esperado: [play(ZAP)],
  },

  // ---- descarte com parceiro ganhando ---------------------------------
  {
    id: "descarte-parceiro-zap-1",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, SETE, ZAP, Q]),
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "descarte-parceiro-zap-2",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, AS, COPAS, DOIS]),
      handCards: [QUATRO, ZAP],
      legalActions: legalCards([QUATRO, ZAP]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "descarte-parceiro-3-folga",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, SETE, TRES, Q]),
      handCards: [QUATRO, J],
      legalActions: legalCards([QUATRO, J]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "descarte-nao-ultimo",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, null, ZAP, SETE]),
      handCards: [QUATRO, AS],
      legalActions: legalCards([QUATRO, AS]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "descarte-guarda-manilha",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, Q, COPAS, K]),
      handCards: [SETE, ESPADAS],
      legalActions: legalCards([SETE, ESPADAS]),
    }),
    esperado: [play(SETE)],
  },
  {
    id: "descarte-parceiro-2-vs-fracos",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, SEIS, DOIS, SETE]),
      handCards: [QUATRO, AS],
      legalActions: legalCards([QUATRO, AS]),
    }),
    esperado: [play(QUATRO)],
  },

  // ---- carta coberta ---------------------------------------------------
  {
    id: "coberta-nao-na-1a",
    categoria: "coberta",
    view: view({
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "coberta-nao-quando-vence",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, SETE, null, null]),
      handCards: [AS, TRES],
      legalActions: legalCards([AS, TRES], hiddenOf([AS, TRES])),
    }),
    esperado: [play(AS)],
  },
  {
    id: "coberta-esconde-3-perdendo",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, ZAP, null, null]),
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES], hiddenOf([QUATRO, TRES])),
    }),
    esperado: [hide(1)],
  },
  {
    id: "coberta-esconde-zap-parceiro-leva",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, SETE, COPAS, Q]),
      handCards: [QUATRO, ZAP],
      legalActions: legalCards([QUATRO, ZAP], hiddenOf([QUATRO, ZAP])),
    }),
    esperado: [hide(1)],
  },
  {
    id: "coberta-esconde-3-parceiro-leva",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, SETE, ZAP, Q]),
      handCards: [QUATRO, TRES],
      legalActions: legalCards([QUATRO, TRES], hiddenOf([QUATRO, TRES])),
    }),
    esperado: [hide(1)],
  },
  {
    id: "coberta-3a-nao-ganha",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0), firstVaza(1)],
      currentVaza: inPlay(0, [null, ZAP, null, null]),
      handCards: [TRES],
      legalActions: legalCards([TRES], hiddenOf([TRES])),
    }),
    esperado: [hide(0)],
  },
  {
    id: "coberta-2a-irrelevante",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, AS, COPAS, DOIS]),
      handCards: [J],
      legalActions: legalCards([J], hiddenOf([J])),
    }),
    esperado: [hide(0)],
  },
  {
    id: "coberta-esconde-manilha-fraca",
    categoria: "coberta",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(0)],
      currentVaza: inPlay(0, [null, ZAP, null, null]),
      handCards: [OUROS_M, QUATRO],
      legalActions: legalCards([OUROS_M, QUATRO], hiddenOf([OUROS_M, QUATRO])),
    }),
    esperado: [hide(0)],
  },

  // ---- truco marginal --------------------------------------------------
  {
    id: "truco-lixo-vs-3",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, SEIS, SETE],
      trucoPendingTeam: 1,
      trucoPendingValue: 3,
      trucoValue: 1,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("run")],
  },
  {
    id: "truco-lixo-vs-6",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, SEIS, SETE],
      trucoPendingTeam: 1,
      trucoPendingValue: 6,
      trucoValue: 3,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("run")],
  },
  {
    id: "truco-lixo-vs-9",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, Q, J],
      trucoPendingTeam: 1,
      trucoPendingValue: 9,
      trucoValue: 6,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("run")],
  },
  {
    id: "truco-lixo-vs-12",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, SEIS, SETE],
      trucoPendingTeam: 1,
      trucoPendingValue: 12,
      trucoValue: 9,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("run")],
  },
  {
    id: "truco-zap-vs-3",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, SETE, ZAP],
      trucoPendingTeam: 1,
      trucoPendingValue: 3,
      trucoValue: 1,
      legalActions: [
        truco("accept"),
        truco("run"),
        truco("raise"),
        { type: "surrender" },
      ],
    }),
    esperado: [truco("accept"), truco("raise")],
  },
  {
    id: "truco-duas-manilhas-vs-3",
    categoria: "truco",
    view: view({
      handCards: [QUATRO, COPAS, ZAP],
      trucoPendingTeam: 1,
      trucoPendingValue: 3,
      trucoValue: 1,
      legalActions: [
        truco("accept"),
        truco("run"),
        truco("raise"),
        { type: "surrender" },
      ],
    }),
    esperado: [truco("accept"), truco("raise")],
  },
  {
    id: "truco-zap-vs-12",
    categoria: "truco",
    view: view({
      handCards: [SEIS, SETE, ZAP],
      trucoPendingTeam: 1,
      trucoPendingValue: 12,
      trucoValue: 9,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("accept")],
  },
  {
    id: "truco-lixo-vs-3-naipe-misto",
    categoria: "truco",
    view: view({
      handCards: [C("4", "copas"), C("6", "paus"), C("7", "espadas")],
      trucoPendingTeam: 1,
      trucoPendingValue: 3,
      trucoValue: 1,
      legalActions: [truco("accept"), truco("run"), { type: "surrender" }],
    }),
    esperado: [truco("run")],
  },

  // ---- mão de onze -----------------------------------------------------
  {
    id: "onze-par-forte",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 5],
      handCards: [ZAP, TRES, QUATRO],
      partnerCards: [COPAS, DOIS, SETE],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("play")],
  },
  {
    id: "onze-lixo",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 4],
      handCards: [QUATRO, SEIS, SETE],
      partnerCards: [Q, J, K],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("run")],
  },
  {
    id: "onze-so-eu-forte",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 6],
      handCards: [ZAP, TRES, DOIS],
      partnerCards: [QUATRO, SEIS, SETE],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("play")],
  },
  {
    id: "onze-dois-tres",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 8],
      handCards: [TRES, AS, QUATRO],
      partnerCards: [C("3", "paus"), DOIS, SETE],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("play")],
  },
  {
    id: "onze-duas-manilhas-minhas",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 2],
      handCards: [ZAP, COPAS, QUATRO],
      partnerCards: [SEIS, SETE, Q],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("play")],
  },
  {
    id: "onze-par-medio-piso",
    categoria: "mao-de-onze",
    view: view({
      isElevenHand: true,
      scores: [11, 7],
      handCards: [DOIS, AS, QUATRO],
      partnerCards: [C("2", "paus"), K, SETE],
      legalActions: [eleven("play"), eleven("run")],
    }),
    esperado: [eleven("run")],
  },

  // ---- ferro + T8 desempate -------------------------------------------
  {
    id: "ferro-indice-unico",
    categoria: "ferro",
    view: view({
      isFerro: true,
      isElevenHand: true,
      scores: [11, 11],
      handCards: [],
      legalActions: [hide(0), { type: "surrender" }],
    }),
    esperado: [hide(0)],
  },
  {
    id: "ferro-nao-surrender",
    categoria: "ferro",
    view: view({
      isFerro: true,
      isElevenHand: true,
      scores: [11, 11],
      handCards: [],
      legalActions: [hide(0), hide(1), hide(2), { type: "surrender" }],
    }),
    esperado: [hide(0), hide(1), hide(2)],
    pred: (got) => got?.type === "playHiddenCard",
  },
  {
    id: "ferro-rng-nao-sempre-0",
    categoria: "ferro",
    view: view({
      isFerro: true,
      isElevenHand: true,
      scores: [11, 11],
      handCards: [],
      legalActions: [hide(0), hide(1), hide(2), { type: "surrender" }],
    }),
    esperado: [hide(0), hide(1), hide(2)],
    pred: () => {
      const idxs = [0.05, 0.35, 0.65, 0.95].map((r) => {
        const a = decideHeuristicV3Action(
          view({
            isFerro: true,
            isElevenHand: true,
            scores: [11, 11],
            handCards: [],
            legalActions: [hide(0), hide(1), hide(2), { type: "surrender" }],
          }),
          () => r,
        );
        return a?.type === "playHiddenCard" ? a.cardIndex : -1;
      });
      return new Set(idxs).size > 1;
    },
  },
  {
    id: "t3-1a-min-nao-cobre-joga-zap",
    categoria: "abertura",
    view: view({
      currentVaza: inPlay(0, [null, SEIS, null, null]),
      handCards: [QUATRO, SETE, ZAP],
      legalActions: legalCards([QUATRO, SETE, ZAP]),
    }),
    esperado: [play(ZAP)],
  },
  {
    id: "t3-1a-ultimo-ainda-min",
    categoria: "abertura",
    view: view({
      currentVaza: inPlay(0, [null, SEIS, C("4", "copas"), C("4", "espadas")]),
      handCards: [SETE, ZAP],
      legalActions: legalCards([SETE, ZAP]),
    }),
    esperado: [play(SETE)],
  },
  {
    id: "t3-1a-sem-lock-descarta-lixo",
    categoria: "abertura",
    view: view({
      currentVaza: inPlay(0, [null, SETE, null, null]),
      handCards: [QUATRO, AS, TRES],
      legalActions: legalCards([QUATRO, AS, TRES]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "t3-mustwin-joga-maior",
    categoria: "segunda-vaza",
    view: view({
      mySeat: 0,
      completedVazas: [firstVaza(1)],
      currentVaza: inPlay(0, [null, SETE, null, null]),
      handCards: [AS, TRES],
      legalActions: legalCards([AS, TRES]),
    }),
    esperado: [play(TRES)],
  },
  {
    id: "t5-sem-folga-tranca-zap",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, null, AS, Q]),
      handCards: [QUATRO, ZAP],
      legalActions: legalCards([QUATRO, ZAP]),
    }),
    esperado: [play(ZAP)],
  },
  {
    id: "t5-sem-folga-coberta-barata",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, null, AS, Q]),
      handCards: [QUATRO, COPAS, ZAP],
      legalActions: legalCards([QUATRO, COPAS, ZAP]),
    }),
    esperado: [play(COPAS)],
  },
  {
    id: "t5-nao-come-3-do-parceiro",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, null, TRES, Q]),
      handCards: [QUATRO, ZAP],
      legalActions: legalCards([QUATRO, ZAP]),
    }),
    esperado: [play(QUATRO)],
  },
  {
    id: "t5-ultimo-ainda-descarta",
    categoria: "descarte",
    view: view({
      mySeat: 0,
      currentVaza: inPlay(0, [null, SEIS, SETE, QUATRO]),
      handCards: [AS, ZAP],
      legalActions: legalCards([AS, ZAP]),
    }),
    esperado: [play(AS)],
  },
  {
    id: "t8-dois-4-nao-sempre-primeiro",
    categoria: "abertura",
    view: view({
      handCards: [C("4", "ouros"), C("4", "copas"), SETE],
      legalActions: legalCards([C("4", "ouros"), C("4", "copas"), SETE]),
    }),
    esperado: [play(C("4", "ouros")), play(C("4", "copas"))],
    pred: () => {
      const v = view({
        handCards: [C("4", "ouros"), C("4", "copas"), SETE],
        legalActions: legalCards([C("4", "ouros"), C("4", "copas"), SETE]),
      });
      const cards = [0.1, 0.9].map((r) => {
        const a = decideHeuristicV3Action(v, () => r);
        return a?.type === "playCard" ? `${a.card.suit}-${a.card.rank}` : "";
      });
      return new Set(cards).size > 1;
    },
  },
];

/**
 * Posições que o v3 atual já acerta. O resto é falha conhecida (T1 coberta,
 * T3 margem, T5 sem folga) — E2 remove ids desta lista-negativa ao corrigir.
 *
 * Preenchido na primeira corrida da E1; não editar sem rerodar o teste.
 */
const V3_PASSING: readonly string[] = [
  "abertura-fraca-1",
  "abertura-fraca-2",
  "abertura-fraca-3",
  "abertura-duas-manilhas-1",
  "abertura-duas-manilhas-2",
  "abertura-zap-lixo",
  "abertura-2a-perdeu-1a-1",
  "abertura-2a-perdeu-1a-2",
  "abertura-2a-ganhou-1a",
  "canga-7-1",
  "canga-q-1",
  "canga-a-1",
  "canga-3-1",
  "canga-nao-quando-perdeu-1a",
  "canga-k-1",
  "segunda-min-win-1",
  "segunda-min-win-2",
  "segunda-min-win-3",
  "segunda-ultimo-min-win",
  "segunda-nao-ganha-descarta",
  "segunda-as-vs-k",
  "terceira-min-win-1",
  "terceira-min-win-2",
  "terceira-min-win-3",
  "terceira-ultimo-min-win",
  "terceira-nao-ganha",
  "terceira-so-manilha-vence",
  "descarte-parceiro-zap-1",
  "descarte-parceiro-zap-2",
  "descarte-parceiro-3-folga",
  "descarte-nao-ultimo",
  "descarte-guarda-manilha",
  "descarte-parceiro-2-vs-fracos",
  "t5-nao-come-3-do-parceiro",
  "t5-ultimo-ainda-descarta",
  "coberta-nao-na-1a",
  "coberta-nao-quando-vence",
  "truco-lixo-vs-3",
  "truco-lixo-vs-6",
  "truco-lixo-vs-9",
  "truco-lixo-vs-12",
  "truco-zap-vs-3",
  "truco-duas-manilhas-vs-3",
  "truco-zap-vs-12",
  "truco-lixo-vs-3-naipe-misto",
  "onze-par-forte",
  "onze-lixo",
  "onze-so-eu-forte",
  "onze-dois-tres",
  "onze-duas-manilhas-minhas",
  "onze-par-medio-piso",
  "ferro-indice-unico",
  "ferro-nao-surrender",
  "ferro-rng-nao-sempre-0",
  "t8-dois-4-nao-sempre-primeiro",
  "t3-1a-ultimo-ainda-min",
  "t3-1a-sem-lock-descarta-lixo",
  "t5-sem-folga-coberta-barata",
];

describe("posições táticas (E1)", () => {
  it("tem 50–100 casos e cobre as categorias pedidas", () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(50);
    expect(CASOS.length).toBeLessThanOrEqual(100);
    const cats = new Set(CASOS.map((c) => c.categoria));
    expect(cats).toEqual(
      new Set([
        "abertura",
        "canga",
        "segunda-vaza",
        "terceira-vaza",
        "descarte",
        "coberta",
        "truco",
        "mao-de-onze",
        "ferro",
      ]),
    );
    const ids = CASOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada fixture só espera ações legais", () => {
    for (const t of CASOS) {
      for (const e of t.esperado) {
        const ok = t.view.legalActions.some((a) => actionEq(a, e));
        expect(ok, `${t.id} espera ${JSON.stringify(e)}`).toBe(true);
      }
    }
  });

  it("v3 devolve ação legal em todas as posições", () => {
    for (const t of CASOS) {
      const got = decideHeuristicV3Action(t.view, midRng);
      expect(got, t.id).not.toBeNull();
      if (got === null) continue;
      const ok = t.view.legalActions.some((a) => actionEq(a, got));
      expect(ok, `${t.id} → ${JSON.stringify(got)}`).toBe(true);
    }
  });

  it("catálogo v3: passing/failing estável (E2 atualiza)", () => {
    const passing = CASOS.filter((c) => hits(c)).map((c) => c.id);
    const failing = CASOS.filter((c) => !hits(c)).map((c) => c.id);
    expect(passing.sort()).toEqual([...V3_PASSING].sort());
    const expectedFailing = CASOS.map((c) => c.id).filter(
      (id) => !V3_PASSING.includes(id),
    );
    expect(failing.sort()).toEqual(expectedFailing.sort());
  });
});
