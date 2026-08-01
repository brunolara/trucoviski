/* ------------------------------------------------------------------ */
/*  Histórico da partida → prosa para o console (estilo PokerStars)   */
/* ------------------------------------------------------------------ */

import type { Card, LogEntry } from "@trucoviski/shared";
import { isManilha, paulista } from "@trucoviski/shared";

export interface LogLine {
  /** Mão a que a linha pertence (divisor no modal). */
  hand: number;
  /** "20:14:02" */
  time: string;
  text: string;
  /** Colore a linha com --team-blue / --team-red. */
  team?: 0 | 1;
  /** Divisor de mão (renderizado como <h3>). */
  divider?: boolean;
}

const RANK_NAMES: Record<string, string> = {
  A: "ás",
  K: "rei",
  J: "valete",
  Q: "dama",
};

const TRUCO_VALUE_NAME: Record<number, string> = {
  3: "TRUCO",
  6: "SEIS",
  9: "NOVE",
  12: "DOZE",
};

const HAND_REASON: Record<string, string> = {
  vazas: "por vazas",
  run: "por corrida",
  surrender: "por desistência",
};

/** Time 0 = seats 0/2 (azul), time 1 = seats 1/3 (vermelho). */
export function seatTeam(s: number): 0 | 1 {
  return s === 0 || s === 2 ? 0 : 1;
}

export function seatName(nicknames: Record<number, string>, s: number): string {
  return nicknames[s] ?? `Jogador ${s + 1}`;
}

export function cardIsManilha(card: Card, vira: Card): boolean {
  return isManilha(card, vira, paulista.rankOrder);
}

/** "4 de paus (manilha)" ou "rei de copas". */
export function cardLabel(card: Card, vira: Card | null): string {
  const rank = RANK_NAMES[card.rank] ?? card.rank;
  const base = `${rank} de ${card.suit}`;
  if (vira && cardIsManilha(card, vira)) return `${base} (manilha)`;
  return base;
}

function formatTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function teamLabel(team: 0 | 1): string {
  return team === 0 ? "azul" : "vermelho";
}

function tentoWord(n: number): string {
  return n === 1 ? "tento" : "tentos";
}

/**
 * Converte o log do servidor em linhas de prosa para o modal.
 * Mantém hand/vira/scores enquanto varre o array uma vez.
 */
export function logLines(
  log: LogEntry[],
  nicknames: Record<number, string>,
): LogLine[] {
  const lines: LogLine[] = [];
  let hand = 0;
  let vira: Card | null = null;
  const scores: [number, number] = [0, 0];
  const name = (s: number) => seatName(nicknames, s);

  for (const entry of log) {
    const time = formatTime(entry.t);

    if (entry.kind === "system") {
      lines.push({ hand, time, text: entry.text });
      continue;
    }
    if (entry.kind === "chat") {
      lines.push({
        hand,
        time,
        text: `💬 ${name(entry.seat)}: ${entry.text}`,
        team: seatTeam(entry.seat),
      });
      continue;
    }
    if (entry.kind === "emote") {
      lines.push({
        hand,
        time,
        text: `${entry.emoji} ${name(entry.seat)}`,
        team: seatTeam(entry.seat),
      });
      continue;
    }
    if (entry.kind === "tomato") {
      lines.push({
        hand,
        time,
        text: `🍅 ${name(entry.senderSeat)} acertou um tomate em ${name(entry.targetSeat)}`,
        team: seatTeam(entry.senderSeat),
      });
      continue;
    }

    const e = entry.event;
    switch (e.type) {
      case "handStarted": {
        hand = e.handNumber;
        vira = e.vira;
        lines.push({
          hand,
          time,
          text: `Mão ${e.handNumber} — vira: ${cardLabel(e.vira, null)} — embaralhou: ${name(e.dealerSeat)}`,
          divider: true,
        });
        break;
      }
      case "cardPlayed": {
        const played =
          e.covered || e.card === null
            ? "carta coberta"
            : cardLabel(e.card, vira);
        lines.push({
          hand,
          time,
          text: `${name(e.seat)} jogou ${played}`,
          team: seatTeam(e.seat),
        });
        break;
      }
      case "vazaCompleted": {
        if (e.winner === null) {
          lines.push({
            hand,
            time,
            text: `Vaza ${e.vazaNumber}: canga (empate)`,
          });
        } else {
          const winning = e.plays[e.winner];
          const withCard =
            winning !== null && winning !== undefined && !e.covered[e.winner]
              ? ` com ${cardLabel(winning, vira)}`
              : "";
          lines.push({
            hand,
            time,
            text: `Vaza ${e.vazaNumber}: ${name(e.winner)} venceu${withCard}`,
            team: seatTeam(e.winner),
          });
        }
        break;
      }
      case "trucoRaised": {
        const label = TRUCO_VALUE_NAME[e.pendingValue] ?? e.pendingValue;
        lines.push({
          hand,
          time,
          text: `${name(e.seat)} pediu ${label}! Valendo ${e.pendingValue}`,
          team: seatTeam(e.seat),
        });
        break;
      }
      case "trucoAccepted": {
        lines.push({
          hand,
          time,
          text: `Truco aceito — valendo ${e.value}`,
        });
        break;
      }
      case "trucoRan": {
        lines.push({
          hand,
          time,
          text: `${name(e.seat)} correu! Time ${teamLabel(e.winnerTeam)} +${e.tentos} ${tentoWord(e.tentos)}`,
          team: e.winnerTeam,
        });
        break;
      }
      case "surrendered": {
        lines.push({
          hand,
          time,
          text: `${name(e.seat)} desistiu! Time ${teamLabel(e.winnerTeam)} +${e.tentos} ${tentoWord(e.tentos)}`,
          team: e.winnerTeam,
        });
        break;
      }
      case "elevenDecided": {
        lines.push({
          hand,
          time,
          text: `Mão de onze: decidiram ${e.decision === "play" ? "jogar" : "correr"}`,
        });
        break;
      }
      case "handFinished": {
        scores[e.winnerTeam] += e.tentos;
        const reason = HAND_REASON[e.reason] ?? e.reason;
        lines.push({
          hand,
          time,
          text: `Mão ${hand}: time ${teamLabel(e.winnerTeam)} +${e.tentos} ${tentoWord(e.tentos)} (${reason}) — placar ${scores[0]}×${scores[1]}`,
          team: e.winnerTeam,
        });
        break;
      }
      case "matchFinished": {
        lines.push({
          hand,
          time,
          text: `Fim de partida: time ${teamLabel(e.winnerTeam)} venceu ${e.finalScores[0]}×${e.finalScores[1]}`,
          team: e.winnerTeam,
        });
        break;
      }
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }

  return lines;
}
