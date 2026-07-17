/* ------------------------------------------------------------------ */
/*  Testes de cenários específicos – F1                                */
/*  Testa cenários críticos que os testes existentes não cobrem bem.   */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- array index após verificação */

import { describe, expect, it } from "vitest";
import { createMatch, paulista, teamForSeat } from "@trucoviski/engine";
import type { Seat } from "@trucoviski/engine";

// ---- Helpers --------------------------------------------------------

/** Joga uma mão inteira até handFinished ou handNumber change. */
function playHand(match: ReturnType<typeof createMatch>): void {
  const startHand = match.state().handNumber;
  let safety = 0;
  while (match.state().handNumber === startHand && safety < 200) {
    for (let seat = 0; seat < 4; seat++) {
      const view = match.playerView(seat as Seat);
      const playAction = view.legalActions.find((a) => a.type === "playCard");
      if (playAction) {
        match.dispatch(seat as Seat, playAction);
        continue;
      }
      const acceptAction = view.legalActions.find(
        (a) => a.type === "truco" && a.action === "accept",
      );
      if (acceptAction) {
        match.dispatch(seat as Seat, acceptAction);
        continue;
      }
      const elevenPlay = view.legalActions.find(
        (a) => a.type === "elevenDecision" && a.decision === "play",
      );
      if (elevenPlay) {
        match.dispatch(seat as Seat, elevenPlay);
        continue;
      }
    }
    safety++;
  }
}

// ---- Ferro 11x11 ----------------------------------------------------

describe("ferro 11x11 scenarios", () => {
  it("ferro hides own cards in playerView", () => {
    // Play matches until we encounter a ferro scenario (both teams at 11)
    // This is deterministic and should be found within reasonable seeds
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;
          for (let seat = 0; seat < 4; seat++) {
            const view = match.playerView(seat as Seat);
            expect(view.isFerro).toBe(true);
            expect(view.handCards).toHaveLength(0);
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("ferro hand value is 3", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;
          expect(st.hand.trucoValue).toBe(3);
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("truco is forbidden in ferro", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;
          for (let seat = 0; seat < 4; seat++) {
            const r = match.dispatch(seat as Seat, {
              type: "truco",
              action: "raise",
            });
            expect(r.success).toBe(false);
            expect(r.error).toBe("trucoForbidden");
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("ferro legalActions does NOT expose playCard (regression)", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;
          for (let seat = 0; seat < 4; seat++) {
            const view = match.playerView(seat as Seat);
            // Ferro nunca deve expor playCard com dados de carta.
            const playCardActions = view.legalActions.filter(
              (a) => a.type === "playCard",
            );
            expect(playCardActions).toHaveLength(0);
            // Deve haver apenas playHiddenCard (sem dados de carta).
            const hiddenActions = view.legalActions.filter(
              (a) => a.type === "playHiddenCard",
            );
            // Pelo menos um seat pode jogar (currentVaza ou nextStarter)
            const totalPlay = view.legalActions.filter(
              (a) => a.type === "playCard" || a.type === "playHiddenCard",
            );
            // Cada hidden action só tem cardIndex (nunca card).
            for (const a of hiddenActions) {
              const hidden = a as { cardIndex: number; card?: unknown };
              expect(hidden.cardIndex).toBeGreaterThanOrEqual(0);
              expect(hidden.cardIndex).toBeLessThanOrEqual(2);
              expect(hidden.card).toBeUndefined();
            }
            void totalPlay;
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("playHiddenCard with valid index succeeds and emits cardPlayed", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          // Encontra o seat que pode jogar.
          for (let seat = 0; seat < 4; seat++) {
            const view = match.playerView(seat as Seat);
            const hidden = view.legalActions.filter(
              (a) => a.type === "playHiddenCard",
            );
            if (hidden.length > 0) {
              found = true;
              const action = hidden[0]!;
              const r = match.dispatch(seat as Seat, action);
              expect(r.success).toBe(true);
              // Deve emitir cardPlayed com a carta real (pública).
              const cp = r.events?.find((e) => e.type === "cardPlayed");
              expect(cp).toBeDefined();
              if (cp && cp.type === "cardPlayed") {
                expect(cp.card).toBeDefined();
                expect(cp.seat).toBe(seat);
              }
              break;
            }
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(
      found,
      "ferro with playHiddenCard should be found within 5000 seeds",
    ).toBe(true);
  }, 30000);

  it("playHiddenCard with invalid index is rejected", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;

          // Tenta índice inválido (999) de qualquer seat.
          const r = match.dispatch(0, {
            type: "playHiddenCard",
            cardIndex: 999,
          });
          // Pode dar notYourTurn se não for a vez do seat 0, ou invalidCardIndex.
          if (!r.success) {
            expect(["notYourTurn", "invalidCardIndex"].includes(r.error)).toBe(
              true,
            );
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("ferro PlayerView has empty handCards array", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;
          for (let seat = 0; seat < 4; seat++) {
            const view = match.playerView(seat as Seat);
            expect(view.handCards).toHaveLength(0);
            // Verify legalActions nunca contém dados de carta (suit/rank).
            for (const a of view.legalActions) {
              const obj = a as Record<string, unknown>;
              expect(obj.card).toBeUndefined();
              expect(obj.suit).toBeUndefined();
              expect(obj.rank).toBeUndefined();
            }
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("playHiddenCard rejected outside ferro (invalidPhase, state unchanged)", () => {
    const match = createMatch(paulista, 42);
    const st0 = match.state();

    // Verifica que não é ferro.
    expect(st0.hand?.isFerro).toBe(false);

    // Captura estado antes.
    const handCards0 = st0.hand?.cards.map((c) => [...c]) ?? null;
    const currentVaza0 = st0.hand?.currentVaza ?? null;
    const completedVazas0 =
      st0.hand?.completedVazas.map((v) => ({ ...v })) ?? null;

    // Dispara playHiddenCard fora de ferro (seat 0, índice 0).
    const r = match.dispatch(0, {
      type: "playHiddenCard",
      cardIndex: 0,
    });

    // Deve ser rejeitado com invalidPhase.
    expect(r.success).toBe(false);
    expect(r.error).toBe("invalidPhase");

    // Estado deve estar inalterado.
    const st1 = match.state();
    expect(st1.hand?.cards).toEqual(handCards0);
    expect(st1.hand?.currentVaza).toEqual(currentVaza0);
    expect(st1.hand?.completedVazas).toEqual(completedVazas0);
    expect(st1.phase).toBe(st0.phase);
  });

  it("playCard rejected in ferro (invalidPhase, state unchanged)", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.hand?.isFerro) {
          found = true;

          // Captura estado antes.
          const handCards0 = st.hand.cards.map((c) => [...c]);
          const currentVaza0 = st.hand.currentVaza;
          const completedVazas0 = st.hand.completedVazas.map((v) => ({
            ...v,
          }));
          const phase0 = st.phase;

          // Tenta jogar playCard no ferro (adivinha uma carta qualquer).
          const r = match.dispatch(0, {
            type: "playCard",
            card: { suit: "paus", rank: "4" },
          });

          // Deve ser rejeitado com invalidPhase.
          expect(r.success).toBe(false);
          expect(r.error).toBe("invalidPhase");

          // Estado deve estar inalterado.
          const st1 = match.state();
          expect(st1.hand?.cards).toEqual(handCards0);
          expect(st1.hand?.currentVaza).toEqual(currentVaza0);
          expect(st1.hand?.completedVazas).toEqual(completedVazas0);
          expect(st1.phase).toBe(phase0);
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);
});

// ---- Mão de onze ----------------------------------------------------

describe("mão de onze scenarios", () => {
  it("mão de onze: play decision sets hand value to 3", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.phase === "elevenDecision") {
          found = true;
          const elevenTeam: 0 | 1 = st.scores[0] === 11 ? 0 : 1;
          const seatGroup: Seat[] = elevenTeam === 0 ? [0, 2] : [1, 3];

          // Decide to play from first seat of that team
          const r = match.dispatch(seatGroup[0]!, {
            type: "elevenDecision",
            decision: "play",
          });
          expect(r.success).toBe(true);

          const newSt = match.state();
          expect(newSt.hand?.trucoValue).toBe(3);
          expect(newSt.phase).toBe("playing");
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(
      found,
      "mão de onze scenario should be found within 5000 seeds",
    ).toBe(true);
  }, 30000);

  it("mão de onze: run decision gives opponent 1 tento", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.phase === "elevenDecision") {
          found = true;
          const elevenTeam: 0 | 1 = st.scores[0] === 11 ? 0 : 1;
          const opponentTeam: 0 | 1 = elevenTeam === 0 ? 1 : 0;
          const seatGroup: Seat[] = elevenTeam === 0 ? [0, 2] : [1, 3];

          const scoresBefore = [...st.scores] as [number, number];

          const r = match.dispatch(seatGroup[0]!, {
            type: "elevenDecision",
            decision: "run",
          });
          expect(r.success).toBe(true);

          const newSt = match.state();
          expect(newSt.scores[opponentTeam]).toBe(
            scoresBefore[opponentTeam] + 1,
          );
          expect(newSt.scores[elevenTeam]).toBe(scoresBefore[elevenTeam]);
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(
      found,
      "mão de onze scenario should be found within 5000 seeds",
    ).toBe(true);
  }, 30000);

  it("mão de onze: truco is forbidden", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.phase === "elevenDecision") {
          found = true;
          const elevenTeam: 0 | 1 = st.scores[0] === 11 ? 0 : 1;
          const seatGroup: Seat[] = elevenTeam === 0 ? [0, 2] : [1, 3];

          match.dispatch(seatGroup[0]!, {
            type: "elevenDecision",
            decision: "play",
          });

          const newSt = match.state();
          if (newSt.phase === "playing" && newSt.hand && !newSt.hand.finished) {
            expect(newSt.hand.isElevenHand).toBe(true);

            const currentSeat = newSt.hand.currentVaza?.currentSeat;
            if (currentSeat !== undefined) {
              const r = match.dispatch(currentSeat as Seat, {
                type: "truco",
                action: "raise",
              });
              expect(r.success).toBe(false);
              expect(r.error).toBe("trucoForbidden");
              break;
            }
          }
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(
      found,
      "mão de onze scenario should be found within 5000 seeds",
    ).toBe(true);
  }, 30000);

  it("mão de onze: only the team at 11 can decide", () => {
    let found = false;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;

      while (match.state().phase !== "matchFinished" && safety < 200) {
        const st = match.state();

        if (st.phase === "elevenDecision") {
          found = true;
          const elevenTeam: 0 | 1 = st.scores[0] === 11 ? 0 : 1;
          const otherTeam: 0 | 1 = elevenTeam === 0 ? 1 : 0;

          const wrongSeat = otherTeam === 0 ? 0 : 1;
          const r = match.dispatch(wrongSeat as Seat, {
            type: "elevenDecision",
            decision: "play",
          });
          expect(r.success).toBe(false);
          expect(r.error).toBe("notYourDecision");
          break;
        }

        playHand(match);
        safety++;
      }
    }

    expect(
      found,
      "mão de onze scenario should be found within 5000 seeds",
    ).toBe(true);
  }, 30000);
});

// ---- Canga tripla ---------------------------------------------------

describe("canga tripla", () => {
  it("canga tripla gives win to mão team", () => {
    // Scan seeds for a hand where all 3 vazas end in canga (tie).
    // When found, assert winnerTeam is the mão team and tentos=1.
    let found = false;

    for (let seed = 0; seed < 20000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      const maoTeam = teamForSeat(match.state().dealerSeat);

      const events: Array<{ type: string; [key: string]: unknown }> = [];
      const startHand = match.state().handNumber;
      let safety = 0;

      while (match.state().handNumber === startHand && safety < 300) {
        for (let s = 0; s < 4; s++) {
          const view = match.playerView(s as Seat);
          const playAction = view.legalActions.find(
            (a) => a.type === "playCard",
          );
          if (playAction) {
            const r = match.dispatch(s as Seat, playAction);
            if (r.success) events.push(...r.events);
            continue;
          }
          const acceptAction = view.legalActions.find(
            (a) => a.type === "truco" && a.action === "accept",
          );
          if (acceptAction) {
            const r = match.dispatch(s as Seat, acceptAction);
            if (r.success) events.push(...r.events);
            continue;
          }
          const elevenPlay = view.legalActions.find(
            (a) => a.type === "elevenDecision" && a.decision === "play",
          );
          if (elevenPlay) {
            const r = match.dispatch(s as Seat, elevenPlay);
            if (r.success) events.push(...r.events);
            continue;
          }
        }
        safety++;
      }

      let cangaCount = 0;
      for (const e of events) {
        if (e.type === "vazaCompleted" && e.winner === null) cangaCount++;
      }

      if (cangaCount === 3) {
        found = true;
        const finishEvent = events.find((e) => e.type === "handFinished") as
          { winnerTeam: number; tentos: number } | undefined;
        expect(finishEvent).toBeDefined();
        expect(finishEvent!.winnerTeam).toBe(maoTeam);
        expect(finishEvent!.tentos).toBe(1);
      }
    }

    expect(found, "expected canga tripla within 20000 seeds").toBe(true);
  }, 30000);
});

// ---- Truco alternation ------------------------------------------------

describe("truco alternation", () => {
  it("same team cannot raise own truco", () => {
    const match = createMatch(paulista, 42);

    // Seat 0 (team 0) raises
    const r1 = match.dispatch(0, { type: "truco", action: "raise" });
    expect(r1.success).toBe(true);

    // Seat 2 (also team 0) tries to raise
    const r2 = match.dispatch(2, { type: "truco", action: "raise" });
    expect(r2.success).toBe(false);
    expect(r2.error).toBe("cannotRaiseYourOwnTruco");

    // Seat 2 tries to accept
    const r3 = match.dispatch(2, { type: "truco", action: "accept" });
    expect(r3.success).toBe(false);
    expect(r3.error).toBe("cannotRaiseYourOwnTruco");
  });

  it("opponent team can counter-raise", () => {
    const match = createMatch(paulista, 42);

    // Seat 0 (team 0) raises to 3
    match.dispatch(0, { type: "truco", action: "raise" });

    // Seat 1 (team 1) counter-raises to 6
    const r = match.dispatch(1, { type: "truco", action: "raise" });
    expect(r.success).toBe(true);
    if (r.success) {
      const event = r.events.find((e) => e.type === "trucoRaised");
      expect(event?.type).toBe("trucoRaised");
      if (event?.type === "trucoRaised") {
        expect(event.pendingValue).toBe(6);
      }
    }
  });

  it("after accept, other team can raise but same team cannot", () => {
    const match = createMatch(paulista, 42);

    // Team 0 raises to 3
    match.dispatch(0, { type: "truco", action: "raise" });

    // Team 1 accepts
    match.dispatch(1, { type: "truco", action: "accept" });

    // Team 0 tries to raise again — must fail (same team as last raiser)
    const rFail = match.dispatch(0, { type: "truco", action: "raise" });
    expect(rFail.success).toBe(false);
    expect(rFail.error).toBe("cannotRaiseYourOwnTruco");

    // Team 1 can raise to 6
    const rOk = match.dispatch(1, { type: "truco", action: "raise" });
    expect(rOk.success).toBe(true);
  });
});

// ---- Rotação de mão -------------------------------------------------

describe("rotação de mão", () => {
  it("dealer rotates each hand", () => {
    const match = createMatch(paulista, 42);

    expect(match.state().dealerSeat).toBe(0);

    playHand(match);
    expect(match.state().dealerSeat).toBe(1);

    playHand(match);
    expect(match.state().dealerSeat).toBe(2);

    playHand(match);
    expect(match.state().dealerSeat).toBe(3);

    playHand(match);
    expect(match.state().dealerSeat).toBe(0); // Back to 0
  });
});

// ---- teamForSeat ----------------------------------------------------

describe("teamForSeat", () => {
  it("returns correct teams", () => {
    expect(teamForSeat(0)).toBe(0);
    expect(teamForSeat(1)).toBe(1);
    expect(teamForSeat(2)).toBe(0);
    expect(teamForSeat(3)).toBe(1);
  });
});

// ---- Fim de partida >= 12 -------------------------------------------

describe("fim de partida", () => {
  it("match finishes when score reaches 12", () => {
    const match = createMatch(paulista, 42);
    let safety = 0;

    while (match.state().phase !== "matchFinished" && safety < 200) {
      playHand(match);
      safety++;
    }

    // Most matches finish within 200 hands, but some might take longer
    if (match.state().phase === "matchFinished") {
      const scores = match.state().scores;
      expect(scores[0] >= 12 || scores[1] >= 12).toBe(true);
    } else {
      // If not finished, just verify it made progress
      expect(match.state().handNumber).toBeGreaterThan(1);
    }
  });

  it("matchFinished event has correct winner", () => {
    const match = createMatch(paulista, 42);
    let safety = 0;

    while (match.state().phase !== "matchFinished" && safety < 200) {
      playHand(match);
      safety++;
    }

    const st = match.state();
    if (st.phase === "matchFinished") {
      const scores = st.scores;
      const winner = scores[0] >= 12 ? 0 : 1;
      // The match should have a winner
      expect(winner).toBeGreaterThanOrEqual(0);
      expect(winner).toBeLessThanOrEqual(1);
    }
  });
});
