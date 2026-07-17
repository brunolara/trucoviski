/* ------------------------------------------------------------------ */
/*  Shared – contrato wire + validação runtime (F3)                    */
/* ------------------------------------------------------------------ */

import { z } from "zod";
import type {
  Action,
  ActionError,
  GameEvent,
  MatchMetadata,
  PlayerView,
} from "@trucoviski/engine";

// ---- Tipos do engine reexportados para conveniência ----------------- */

export type {
  Action,
  ActionError,
  Card,
  GameEvent,
  MatchMetadata,
  PlayerView,
  Seat,
} from "@trucoviski/engine";

// ---- Mensagens cliente → servidor -----------------------------------

export interface ClientActionMessage {
  type: "action";
  payload: unknown;
}

export interface ClientSyncMessage {
  type: "sync";
}

export interface ClientFillBotsMessage {
  type: "fillBots";
}

export interface ClientSetNicknameMessage {
  type: "setNickname";
  nickname: string;
}

export type ClientMessage =
  | ClientActionMessage
  | ClientSyncMessage
  | ClientFillBotsMessage
  | ClientSetNicknameMessage;

// ---- Erros wire ------------------------------------------------------

/** Erro wire enviado ao cliente em actionRejected. */
export type WireError = "roomNotReady" | "malformedPayload" | ActionError;

// ---- Mensagens servidor → cliente -----------------------------------

export interface SnapshotMessage {
  type: "snapshot";
  seat: number;
  status: "waiting" | "playing" | "finished";
  connectedPlayers: number;
  /** sessionId do dono da sala (quem pode preencher com bots). */
  ownerSessionId: string;
  /** Metadados públicos (sem seed) expostos em qualquer status. */
  metadata: {
    rulesetName: string;
    rulesetVersion: string;
    prngVersion: string;
  };
  view?: PlayerView;
  /** Eventos gerados pela última ação. */
  events?: GameEvent[];
  /** Metadados completos incluindo seed – apenas em status finished. */
  replayMetadata?: MatchMetadata;
  /** Nicknames por seat (F3). */
  nicknames?: Record<number, string>;
}

export interface ActionRejectedMessage {
  type: "actionRejected";
  error: WireError;
}

export type ServerMessage = SnapshotMessage | ActionRejectedMessage;

// ---- Validação runtime de setNickname (Zod 4, strict) -----------------

const setNicknamePayloadSchema = z.strictObject({
  nickname: z.string().trim().min(1).max(16),
});

/**
 * Valida o payload de setNickname contra o schema strict.
 * Retorna o nickname validado (já trimado) ou null se inválido.
 */
export function validateSetNickname(
  payload: unknown,
): { nickname: string } | null {
  const result = setNicknamePayloadSchema.safeParse(payload);
  if (result.success) return result.data as { nickname: string };
  return null;
}

// ---- Validação runtime de chat, emote, throwTomato, showCard (F4) ----

const chatPayloadSchema = z.strictObject({
  text: z.string().max(120),
});

export function validateChat(payload: unknown): { text: string } | null {
  const result = chatPayloadSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}

export const EMOJI_WHITELIST = ["👍", "👎", "😂", "😮", "😢", "😠", "🎴", "🍅"];

const emotePayloadSchema = z.strictObject({
  emoji: z.string().refine((val) => EMOJI_WHITELIST.includes(val)),
});

export function validateEmote(payload: unknown): { emoji: string } | null {
  const result = emotePayloadSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}

const throwTomatoPayloadSchema = z.strictObject({
  targetSeat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export function validateThrowTomato(
  payload: unknown,
): { targetSeat: number } | null {
  const result = throwTomatoPayloadSchema.safeParse(payload);
  if (result.success) return result.data as { targetSeat: number };
  return null;
}

const showCardPayloadSchema = z.strictObject({
  cardIndex: z.number().int().min(0).max(2),
});

export function validateShowCard(
  payload: unknown,
): { cardIndex: number } | null {
  const result = showCardPayloadSchema.safeParse(payload);
  if (result.success) return result.data;
  return null;
}

// ---- Validação runtime de Action (Zod 4, strict) ---------------------

const suitEnum = z.enum(["paus", "copas", "espadas", "ouros"]);
const rankEnum = z.enum(["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"]);

const cardSchema = z.strictObject({
  suit: suitEnum,
  rank: rankEnum,
});

const playCardSchema = z.strictObject({
  type: z.literal("playCard"),
  card: cardSchema,
});

const playHiddenCardSchema = z.strictObject({
  type: z.literal("playHiddenCard"),
  cardIndex: z.number().int().min(0).max(2),
});

const trucoSchema = z.strictObject({
  type: z.literal("truco"),
  action: z.enum(["raise", "accept", "run"]),
});

const elevenDecisionSchema = z.strictObject({
  type: z.literal("elevenDecision"),
  decision: z.enum(["play", "run"]),
});

const surrenderSchema = z.strictObject({
  type: z.literal("surrender"),
});

const actionSchema = z.discriminatedUnion("type", [
  playCardSchema,
  playHiddenCardSchema,
  trucoSchema,
  elevenDecisionSchema,
  surrenderSchema,
]);

/**
 * Valida o payload contra o schema de Action (strict).
 * Retorna a Action tipada se válida, null se malformada.
 */
export function validateAction(payload: unknown): Action | null {
  const result = actionSchema.safeParse(payload);
  if (result.success) return result.data as Action;
  return null;
}
