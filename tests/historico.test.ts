/* ------------------------------------------------------------------ */
/*  Histórico da partida → prosa (console)                             */
/* ------------------------------------------------------------------ */

import { describe, expect, it } from "vitest";
import type { LogEntry } from "@trucoviski/shared";
import { cardLabel, logLines } from "../apps/web/src/utils/historico.js";

const NICKS = { 0: "Bruno", 1: "Ana", 2: "Zé", 3: "Lia" };

const VIRA = { rank: "3", suit: "copas" } as const; // manilha = 4
const MANILHA_PAUS = { rank: "4", suit: "paus" } as const;

function event(
  t: number,
  event: Extract<LogEntry, { kind: "event" }>["event"],
): LogEntry {
  return { kind: "event", t, event };
}

describe("cardLabel", () => {
  it("marca manilha pela vira", () => {
    expect(cardLabel(MANILHA_PAUS, VIRA)).toBe("4 de paus (manilha)");
  });

  it("usa nome por extenso para figuras", () => {
    expect(cardLabel({ rank: "K", suit: "copas" }, VIRA)).toBe("rei de copas");
  });
});

describe("logLines", () => {
  const t0 = Date.UTC(2026, 6, 27, 23, 14, 2); // 20:14:02 em UTC-3 → depende do TZ
  // Usa timestamp fixo e confere só o texto; o time é formatado no fuso local.

  it("vaza com manilha, carta coberta e canga", () => {
    const log: LogEntry[] = [
      event(t0, {
        type: "handStarted",
        handNumber: 1,
        dealerSeat: 1,
        vira: VIRA,
      }),
      event(t0 + 1, {
        type: "cardPlayed",
        seat: 0,
        card: MANILHA_PAUS,
        covered: false,
      }),
      event(t0 + 2, {
        type: "cardPlayed",
        seat: 1,
        card: null,
        covered: true,
      }),
      event(t0 + 3, {
        type: "vazaCompleted",
        vazaNumber: 1,
        plays: [
          MANILHA_PAUS,
          null,
          { rank: "K", suit: "ouros" },
          { rank: "A", suit: "espadas" },
        ],
        covered: [false, true, false, false],
        winner: 0,
      }),
      event(t0 + 4, {
        type: "vazaCompleted",
        vazaNumber: 2,
        plays: [
          { rank: "7", suit: "paus" },
          { rank: "7", suit: "copas" },
          { rank: "6", suit: "ouros" },
          { rank: "5", suit: "espadas" },
        ],
        covered: [false, false, false, false],
        winner: null,
      }),
    ];

    const lines = logLines(log, NICKS);
    expect(lines.some((l) => l.divider && l.text.includes("Mão 1"))).toBe(true);
    expect(
      lines.some((l) => l.text === "Bruno jogou 4 de paus (manilha)"),
    ).toBe(true);
    expect(lines.some((l) => l.text === "Ana jogou carta coberta")).toBe(true);
    expect(
      lines.some((l) => l.text.includes("venceu com 4 de paus (manilha)")),
    ).toBe(true);
    expect(lines.some((l) => l.text === "Vaza 2: canga (empate)")).toBe(true);
  });

  it("escada de truco 3→6→9→12 e placar acumulado em duas mãos", () => {
    const log: LogEntry[] = [
      event(t0, {
        type: "handStarted",
        handNumber: 1,
        dealerSeat: 0,
        vira: VIRA,
      }),
      event(t0 + 1, {
        type: "trucoRaised",
        seat: 1,
        pendingValue: 3,
      }),
      event(t0 + 2, { type: "trucoAccepted", value: 3 }),
      event(t0 + 3, {
        type: "trucoRaised",
        seat: 0,
        pendingValue: 6,
      }),
      event(t0 + 4, { type: "trucoAccepted", value: 6 }),
      event(t0 + 5, {
        type: "trucoRaised",
        seat: 1,
        pendingValue: 9,
      }),
      event(t0 + 6, { type: "trucoAccepted", value: 9 }),
      event(t0 + 7, {
        type: "trucoRaised",
        seat: 0,
        pendingValue: 12,
      }),
      event(t0 + 8, { type: "trucoAccepted", value: 12 }),
      event(t0 + 9, {
        type: "handFinished",
        winnerTeam: 0,
        tentos: 12,
        reason: "vazas",
      }),
      event(t0 + 10, {
        type: "handStarted",
        handNumber: 2,
        dealerSeat: 1,
        vira: { rank: "5", suit: "ouros" },
      }),
      event(t0 + 11, {
        type: "trucoRan",
        seat: 0,
        winnerTeam: 1,
        tentos: 1,
      }),
      event(t0 + 12, {
        type: "handFinished",
        winnerTeam: 1,
        tentos: 1,
        reason: "run",
      }),
      event(t0 + 13, {
        type: "matchFinished",
        winnerTeam: 0,
        finalScores: [12, 1],
      }),
    ];

    const texts = logLines(log, NICKS).map((l) => l.text);
    expect(texts.some((t) => t.includes("pediu TRUCO! Valendo 3"))).toBe(true);
    expect(texts.some((t) => t.includes("pediu SEIS! Valendo 6"))).toBe(true);
    expect(texts.some((t) => t.includes("pediu NOVE! Valendo 9"))).toBe(true);
    expect(texts.some((t) => t.includes("pediu DOZE! Valendo 12"))).toBe(true);
    expect(texts).toContain("Truco aceito — valendo 12");
    expect(texts).toContain(
      "Mão 1: time azul +12 tentos (por vazas) — placar 12×0",
    );
    expect(
      texts.some((t) => /Bruno correu! Time vermelho \+1 tento/.test(t)),
    ).toBe(true);
    expect(texts).toContain(
      "Mão 2: time vermelho +1 tento (por corrida) — placar 12×1",
    );
    expect(texts).toContain("Fim de partida: time azul venceu 12×1");
  });

  it("chat, emote e tomate", () => {
    const log: LogEntry[] = [
      { kind: "chat", t: t0, seat: 0, text: "truco neles!" },
      { kind: "emote", t: t0 + 1, seat: 1, emoji: "😂" },
      { kind: "tomato", t: t0 + 2, senderSeat: 0, targetSeat: 2 },
    ];
    const texts = logLines(log, NICKS).map((l) => l.text);
    expect(texts).toContain("💬 Bruno: truco neles!");
    expect(texts).toContain("😂 Ana");
    expect(texts).toContain("🍅 Bruno acertou um tomate em Zé");
  });

  it("surrendered e elevenDecided", () => {
    const log: LogEntry[] = [
      event(t0, {
        type: "handStarted",
        handNumber: 3,
        dealerSeat: 0,
        vira: VIRA,
      }),
      event(t0 + 1, {
        type: "surrendered",
        seat: 0,
        winnerTeam: 1,
        tentos: 3,
      }),
      event(t0 + 2, { type: "elevenDecided", decision: "play" }),
      event(t0 + 3, { type: "elevenDecided", decision: "run" }),
    ];
    const texts = logLines(log, NICKS).map((l) => l.text);
    expect(texts).toContain("Bruno desistiu! Time vermelho +3 tentos");
    expect(texts).toContain("Mão de onze: decidiram jogar");
    expect(texts).toContain("Mão de onze: decidiram correr");
  });
});
