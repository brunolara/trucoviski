/* ------------------------------------------------------------------ */
/*  Engine – barrel público                                           */
/* ------------------------------------------------------------------ */

// Tipos
export type {
  Action,
  ActionError,
  ActionResult,
  Card,
  CardPlayedEvent,
  CompletedVaza,
  ElevenDecidedEvent,
  GameEvent,
  HandFinishedEvent,
  HandStartedEvent,
  HandState,
  MatchFinishedEvent,
  MatchMetadata,
  MatchPhase,
  MatchState,
  PlayerView,
  PlayCardAction,
  PlayHiddenCardAction,
  Rank,
  RuleSet,
  Seat,
  Suit,
  SurrenderAction,
  SurrenderedEvent,
  Team,
  TrucoAcceptedEvent,
  TrucoRaisedEvent,
  TrucoRanEvent,
  TrucoAction,
  ElevenDecisionAction,
  VazaCompletedEvent,
  VazaInProgress,
} from "./types.js";
export { RANKS, SUITS, TEAMS } from "./types.js";

// PRNG
export { createPRNG, PRNG_VERSION } from "./prng.js";
export type { PRNG } from "./prng.js";

// Deck
export {
  createDeck,
  createShuffledDeck,
  DECK_RANKS,
  DECK_SIZE,
  DECK_SUITS,
} from "./deck.js";

// Ranking (agora plugável via RuleSet)
export {
  compareCards,
  isManilha,
  manilhaCards,
  nextRank,
  resolveVaza,
  rankOrder,
  suitOrder,
} from "./ranking.js";
export type { VazaResult } from "./ranking.js";

// Hand helpers
export {
  completeVaza,
  dealCards,
  handPhase,
  isVazaComplete,
  nextVazaStarter,
  playInVaza,
  resolveHandWinner,
  startVaza,
  viraIndex,
} from "./hand.js";

// Rulesets
export { paulista, teamForSeat } from "./rulesets/paulista.js";

// Match (API principal)
export { createMatch } from "./match.js";

// Simulation
export { runArena, runSimulation } from "./simulation.js";
export type {
  ArenaConfig,
  ArenaResult,
  SimulationConfig,
  SimulationResult,
} from "./simulation.js";
