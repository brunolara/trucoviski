/* ------------------------------------------------------------------ */
/*  Tipos fundamentais do engine – F1                                  */
/* ------------------------------------------------------------------ */

// ---- Naipes (ordem de manilha: paus > copas > espadas > ouros) ----

export const SUITS = ["paus", "copas", "espadas", "ouros"] as const;
export type Suit = (typeof SUITS)[number];

// ---- Ranks (fraco → forte: 4 5 6 7 Q J K A 2 3) -------------------

export const RANKS = [
  "4",
  "5",
  "6",
  "7",
  "Q",
  "J",
  "K",
  "A",
  "2",
  "3",
] as const;
export type Rank = (typeof RANKS)[number];

// ---- Carta ---------------------------------------------------------

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

// ---- Assentos e times ----------------------------------------------

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

/** Times fixos: assentos opostos são parceiros. */
export const TEAMS: Record<Seat, Team> = { 0: 0, 1: 1, 2: 0, 3: 1 };

// ---- Ações do jogador ----------------------------------------------

export type Action =
  | PlayCardAction
  | PlayHiddenCardAction
  | TrucoAction
  | ElevenDecisionAction
  | SurrenderAction;

export interface PlayCardAction {
  readonly type: "playCard";
  readonly card: Card;
}

/** Ação opaca para jogar carta no ferro: expõe apenas índice da carta na mão (0‑based). */
export interface PlayHiddenCardAction {
  readonly type: "playHiddenCard";
  readonly cardIndex: number;
}

export interface TrucoAction {
  readonly type: "truco";
  readonly action: "raise" | "accept" | "run";
}

export interface ElevenDecisionAction {
  readonly type: "elevenDecision";
  readonly decision: "play" | "run";
}

/** Desistir da mão: qualquer jogador, a qualquer momento na fase playing sem truco pendente. */
export interface SurrenderAction {
  readonly type: "surrender";
}

// ---- Erros de ação (rejeição tipada, estado inalterado) ------------

export type ActionError =
  | "matchFinished"
  | "invalidPhase"
  | "notYourTurn"
  | "cardNotInHand"
  | "invalidCardIndex"
  | "trucoForbidden"
  | "trucoNotPending"
  | "cannotRaiseYourOwnTruco"
  | "maxTrucoValue"
  | "notYourDecision"
  | "hiddenForbiddenFirstVaza";

// ---- Eventos emitidos pelo engine ----------------------------------

export type GameEvent =
  | HandStartedEvent
  | CardPlayedEvent
  | VazaCompletedEvent
  | TrucoRaisedEvent
  | TrucoAcceptedEvent
  | TrucoRanEvent
  | ElevenDecidedEvent
  | SurrenderedEvent
  | HandFinishedEvent
  | MatchFinishedEvent;

export interface HandStartedEvent {
  readonly type: "handStarted";
  readonly handNumber: number;
  readonly dealerSeat: Seat;
  readonly vira: Card;
}

export interface CardPlayedEvent {
  readonly type: "cardPlayed";
  readonly seat: Seat;
  readonly card: Card | null; // null = carta coberta (nunca revelada)
  readonly covered: boolean;
}

export interface VazaCompletedEvent {
  readonly type: "vazaCompleted";
  readonly vazaNumber: number;
  readonly plays: readonly [Card | null, Card | null, Card | null, Card | null];
  readonly covered: readonly [boolean, boolean, boolean, boolean];
  readonly winner: Seat | null; // null = canga (empate)
}

export interface TrucoRaisedEvent {
  readonly type: "trucoRaised";
  readonly seat: Seat;
  readonly pendingValue: number;
}

export interface TrucoAcceptedEvent {
  readonly type: "trucoAccepted";
  readonly value: number;
}

export interface TrucoRanEvent {
  readonly type: "trucoRan";
  readonly seat: Seat;
  readonly winnerTeam: Team;
  readonly tentos: number;
}

export interface ElevenDecidedEvent {
  readonly type: "elevenDecided";
  readonly decision: "play" | "run";
}

export interface SurrenderedEvent {
  readonly type: "surrendered";
  readonly seat: Seat;
  readonly winnerTeam: Team;
  readonly tentos: number;
}

export interface HandFinishedEvent {
  readonly type: "handFinished";
  readonly winnerTeam: Team;
  readonly tentos: number;
  readonly reason: "vazas" | "run" | "surrender";
}

export interface MatchFinishedEvent {
  readonly type: "matchFinished";
  readonly winnerTeam: Team;
  readonly finalScores: readonly [number, number];
}

// ---- Estado da partida (público, imutável) -------------------------

export type MatchPhase =
  "dealing" | "elevenDecision" | "playing" | "handFinished" | "matchFinished";

export interface MatchState {
  readonly phase: MatchPhase;
  readonly handNumber: number;
  readonly dealerSeat: Seat;
  readonly scores: readonly [number, number];
  readonly hand: HandState | null;
}

export interface HandState {
  readonly vira: Card;
  readonly cards: readonly [
    readonly Card[],
    readonly Card[],
    readonly Card[],
    readonly Card[],
  ];
  readonly completedVazas: readonly CompletedVaza[];
  readonly currentVaza: VazaInProgress | null;
  readonly trucoValue: number;
  readonly trucoPendingTeam: Team | null;
  readonly trucoPendingValue: number | null;
  readonly trucoRaises: readonly TrucoRaiseRecord[];
  readonly isElevenHand: boolean;
  readonly isFerro: boolean;
  readonly elevenDecision: "play" | "run" | null;
  readonly dealerSeat: Seat;
  readonly nextStarter: Seat;
  readonly finished: boolean;
}

export interface CompletedVaza {
  readonly plays: readonly [Card | null, Card | null, Card | null, Card | null];
  readonly covered: readonly [boolean, boolean, boolean, boolean];
  readonly winner: Seat | null; // null = canga
  readonly tiedSeats: readonly Seat[];
}

export interface VazaInProgress {
  readonly plays: readonly [Card | null, Card | null, Card | null, Card | null];
  readonly covered: readonly [boolean, boolean, boolean, boolean];
  readonly currentSeat: Seat;
}

// ---- Estado interno mutável (não exportado do barrel) ---------------

export interface TrucoRaiseRecord {
  readonly seat: Seat;
  readonly team: Team;
  readonly pendingValue: number;
  readonly vazaIndex: number;
}

/** Versão mutável de HandState para uso interno do engine. */
export interface MutableHandState {
  vira: Card;
  cards: [Card[], Card[], Card[], Card[]];
  completedVazas: CompletedVaza[];
  currentVaza: VazaInProgress | null;
  trucoValue: number;
  trucoPendingTeam: Team | null;
  trucoPendingValue: number | null;
  trucoLastRaiser: Team | null;
  /** Histórico público de raises nesta mão (E2 features de aposta). */
  trucoRaises: TrucoRaiseRecord[];
  isElevenHand: boolean;
  isFerro: boolean;
  elevenDecision: "play" | "run" | null;
  dealerSeat: Seat;
  nextStarter: Seat;
  finished: boolean;
}

// ---- Visão do jogador (PlayerView) ---------------------------------

export interface PlayerView {
  readonly handNumber: number;
  readonly mySeat: Seat;
  readonly dealerSeat: Seat;
  readonly handCards: readonly Card[];
  readonly partnerCards?: readonly Card[] | undefined;
  readonly vira: Card;
  readonly completedVazas: readonly CompletedVaza[];
  readonly currentVaza: VazaInProgress | null;
  readonly scores: readonly [number, number];
  readonly trucoValue: number;
  readonly trucoPendingTeam: Team | null;
  readonly trucoPendingValue: number | null;
  /**
   * Raises desta mão (público). Usado pelo bot v4 para features de aposta.
   * Vazio se ninguém pediu truco ainda.
   */
  readonly trucoRaises: readonly TrucoRaiseRecord[];
  readonly isElevenHand: boolean;
  readonly isFerro: boolean;
  readonly elevenDecision: "play" | "run" | null;
  readonly legalActions: readonly Action[];
  /**
   * Mãos de todos os assentos (cartas ainda na mão). Só preenchido quando
   * `createMatch(..., { revealAllHands: true })` — medição/oráculo.
   * // ponytail: campo de medição, nunca ligado em produção
   */
  readonly allHands?: readonly (readonly Card[])[];
}

// ---- Metadados públicos (para replay) ------------------------------

export interface MatchMetadata {
  readonly rulesetName: string;
  readonly rulesetVersion: string;
  readonly prngVersion: string;
  readonly seed: number;
}

// ---- API pública do engine -----------------------------------------

export type ActionResult =
  | { readonly success: true; readonly events: readonly GameEvent[] }
  | { readonly success: false; readonly error: ActionError };

// ---- RuleSet plugável ----------------------------------------------

export interface RuleSet {
  readonly name: string;
  readonly version: string;
  /** Ranks ordenados do mais fraco para o mais forte. */
  readonly rankOrder: readonly Rank[];
  /** Naipes ordenados do mais forte para o mais fraco (desempate de manilhas). */
  readonly suitOrder: readonly Suit[];
  /** Sequência de valores de truco (inclui o valor inicial 1). */
  readonly trucoSequence: readonly number[];
  /** Tentos necessários para vencer a partida. */
  readonly winThreshold: number;
  /** Tentos que disparam "mão de onze". */
  readonly elevenThreshold: number;
  /** Cartas distribuídas por jogador a cada mão. */
  readonly cardsPerPlayer: number;
}
