/* ------------------------------------------------------------------ */
/*  Testes de cenários específicos – F5 (carta coberta fora do ferro)  */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- array index após verificação */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createMatch, paulista } from "@trucoviski/engine";
import type { Seat } from "@trucoviski/engine";

function findSeed(
  predicate: (match: ReturnType<typeof createMatch>) => boolean,
  maxSeed = 2000,
): ReturnType<typeof createMatch> {
  for (let seed = 0; seed < maxSeed; seed++) {
    const match = createMatch(paulista, seed);
    if (predicate(match)) return match;
  }
  throw new Error("no matching seed found");
}

describe("F5: carta coberta fora do ferro", () => {
  it("playHiddenCard is rejected on the 1st vaza (hiddenForbiddenFirstVaza)", () => {
    const match = createMatch(paulista, 42);
    expect(match.state().hand?.isFerro).toBe(false);
    const r = match.dispatch(0, { type: "playHiddenCard", cardIndex: 0 });
    expect(r).toEqual({ success: false, error: "hiddenForbiddenFirstVaza" });
  });

  it("playHiddenCard succeeds from the 2nd vaza, card leaves hand, view shows null+covered for all seats, no event exposes the card", () => {
    const match = createMatch(paulista, 42);

    // Joga a 1ª vaza inteira com playCard normal.
    for (let i = 0; i < 4; i++) {
      const view = match.playerView(
        (match.state().hand!.currentVaza?.currentSeat ??
          match.state().hand!.nextStarter) as Seat,
      );
      const seat = (match.state().hand!.currentVaza?.currentSeat ??
        match.state().hand!.nextStarter) as Seat;
      const action = view.legalActions.find((a) => a.type === "playCard")!;
      const r = match.dispatch(seat, action);
      expect(r.success).toBe(true);
    }
    expect(match.state().hand?.completedVazas.length).toBe(1);

    const seat2 = (match.state().hand!.currentVaza?.currentSeat ??
      match.state().hand!.nextStarter) as Seat;
    const view2 = match.playerView(seat2);
    const handSizeBefore = view2.handCards.length;
    const hiddenAction = view2.legalActions.find(
      (a) => a.type === "playHiddenCard",
    );
    expect(hiddenAction).toBeDefined();

    const result = match.dispatch(seat2, hiddenAction!);
    expect(result.success).toBe(true);
    if (result.success) {
      const cardPlayed = result.events.find((e) => e.type === "cardPlayed");
      expect(cardPlayed).toBeDefined();
      if (cardPlayed && cardPlayed.type === "cardPlayed") {
        expect(cardPlayed.card).toBeNull();
        expect(cardPlayed.covered).toBe(true);
      }
    }

    // A carta some da mão do jogador.
    const viewAfter = match.playerView(seat2);
    expect(viewAfter.handCards.length).toBe(handSizeBefore - 1);

    // Todos os seats veem null + covered no slot da vaza em progresso.
    for (let seat = 0; seat < 4; seat++) {
      const v = match.playerView(seat as Seat);
      expect(v.currentVaza).not.toBeNull();
      expect(v.currentVaza!.plays[seat2]).toBeNull();
      expect(v.currentVaza!.covered[seat2]).toBe(true);
    }
  });

  it("a covered card never wins the vaza", () => {
    // Procura uma semente onde o vencedor da 1ª vaza cobre a manilha mais forte na 2ª.
    let found = false;
    for (let seed = 0; seed < 500 && !found; seed++) {
      const match = createMatch(paulista, seed);

      // Joga a 1ª vaza com playCard.
      for (let i = 0; i < 4; i++) {
        const seat = (match.state().hand!.currentVaza?.currentSeat ??
          match.state().hand!.nextStarter) as Seat;
        const view = match.playerView(seat);
        const action = view.legalActions.find((a) => a.type === "playCard")!;
        match.dispatch(seat, action);
      }
      if (match.state().hand?.completedVazas.length !== 1) continue;

      // Na 2ª vaza, todos jogam coberto exceto o último, que joga a carta mais forte disponível.
      for (let i = 0; i < 3; i++) {
        const seat = (match.state().hand!.currentVaza?.currentSeat ??
          match.state().hand!.nextStarter) as Seat;
        const view = match.playerView(seat);
        const hidden = view.legalActions.find(
          (a) => a.type === "playHiddenCard",
        );
        if (!hidden) break;
        match.dispatch(seat, hidden);
      }
      if (match.state().hand?.currentVaza === null) continue;
      const lastSeat = match.state().hand!.currentVaza!.currentSeat;
      const lastView = match.playerView(lastSeat);
      const playAction = lastView.legalActions.find(
        (a) => a.type === "playCard",
      );
      if (!playAction) continue;
      const before = match.state().hand?.completedVazas.length;
      const r = match.dispatch(lastSeat, playAction);
      if (!r.success) continue;
      const after = match.state().hand?.completedVazas.length;
      if (after !== (before ?? 0) + 1) continue;

      const secondVaza = match.state().hand?.completedVazas[1];
      expect(secondVaza).toBeDefined();
      // O único jogador não-coberto venceu (nunca canga entre 3 cobertas + 1 real).
      expect(secondVaza!.winner).toBe(lastSeat);
      found = true;
    }
    expect(found, "should find a seed exercising this scenario").toBe(true);
  });

  it("4 covered plays in the same vaza result in a tie (canga)", () => {
    const match = findSeed((m) => {
      const h = m.state().hand!;
      return !h.isFerro;
    });

    for (let i = 0; i < 4; i++) {
      const seat = (match.state().hand!.currentVaza?.currentSeat ??
        match.state().hand!.nextStarter) as Seat;
      const view = match.playerView(seat);
      const action = view.legalActions.find((a) => a.type === "playCard")!;
      match.dispatch(seat, action);
    }
    expect(match.state().hand?.completedVazas.length).toBe(1);

    let vazaCompletedEvent: { winner: unknown; covered: unknown } | undefined;
    for (let i = 0; i < 4; i++) {
      const seat = (match.state().hand!.currentVaza?.currentSeat ??
        match.state().hand!.nextStarter) as Seat;
      const view = match.playerView(seat);
      const hidden = view.legalActions.find(
        (a) => a.type === "playHiddenCard",
      )!;
      const r = match.dispatch(seat, hidden);
      expect(r.success).toBe(true);
      if (r.success) {
        const vc = r.events.find((e) => e.type === "vazaCompleted");
        if (vc && vc.type === "vazaCompleted") vazaCompletedEvent = vc;
      }
    }

    // A vaza (a 2ª desta mão) resulta em canga: ninguém venceu.
    expect(vazaCompletedEvent).toBeDefined();
    expect(vazaCompletedEvent!.winner).toBeNull();
    expect(vazaCompletedEvent!.covered).toEqual([true, true, true, true]);
  });

  it("regression: in ferro, playHiddenCard still competes normally and vazaCompleted exposes real cards", () => {
    let found = false;
    for (let seed = 0; seed < 5000 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;
      while (safety < 200) {
        const s = match.state();
        if (s.phase === "matchFinished") break;
        if (s.hand?.isFerro) {
          const seat = (s.hand.currentVaza?.currentSeat ??
            s.hand.nextStarter) as Seat;
          const view = match.playerView(seat);
          const hidden = view.legalActions.find(
            (a) => a.type === "playHiddenCard",
          );
          expect(hidden).toBeDefined();
          const r = match.dispatch(seat, hidden!);
          expect(r.success).toBe(true);
          if (r.success) {
            const cp = r.events.find((e) => e.type === "cardPlayed");
            if (cp && cp.type === "cardPlayed") {
              expect(cp.card).not.toBeNull();
              expect(cp.covered).toBe(false);
            }
            const vc = r.events.find((e) => e.type === "vazaCompleted");
            if (vc && vc.type === "vazaCompleted") {
              for (const p of vc.plays) expect(p).not.toBeNull();
              found = true;
            }
          }
          safety++;
          continue;
        }
        // Fora do ferro: joga normalmente até chegar ao ferro ou terminar.
        let acted = false;
        for (let seat = 0; seat < 4; seat++) {
          const view = match.playerView(seat as Seat);
          const action =
            view.legalActions.find((a) => a.type === "playCard") ??
            view.legalActions.find((a) => a.type === "elevenDecision") ??
            view.legalActions.find(
              (a) => a.type === "truco" && a.action === "accept",
            );
          if (action) {
            match.dispatch(seat as Seat, action);
            acted = true;
            break;
          }
        }
        if (!acted) break;
        safety++;
      }
    }
    expect(found, "ferro scenario should be found within 5000 seeds").toBe(
      true,
    );
  }, 30000);

  it("property: covered cards never leak into any PlayerView or event, for any player choosing to cover", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), (seed) => {
        const match = createMatch(paulista, seed);
        if (match.state().hand?.isFerro) return;

        for (let i = 0; i < 4; i++) {
          const seat = (match.state().hand!.currentVaza?.currentSeat ??
            match.state().hand!.nextStarter) as Seat;
          const view = match.playerView(seat);
          const action = view.legalActions.find((a) => a.type === "playCard");
          if (!action) return;
          match.dispatch(seat, action);
        }
        if (match.state().hand?.completedVazas.length !== 1) return;

        const seat = (match.state().hand!.currentVaza?.currentSeat ??
          match.state().hand!.nextStarter) as Seat;
        const view = match.playerView(seat);
        const hidden = view.legalActions.find(
          (a) => a.type === "playHiddenCard",
        );
        if (!hidden) return;

        const r = match.dispatch(seat, hidden);
        expect(r.success).toBe(true);
        if (!r.success) return;

        const cardPlayed = r.events.find((e) => e.type === "cardPlayed");
        expect(
          cardPlayed && "card" in cardPlayed ? cardPlayed.card : "missing",
        ).toBeNull();

        for (let s = 0; s < 4; s++) {
          const v = match.playerView(s as Seat);
          // A carta coberta nunca aparece — apenas null no slot correspondente da vaza.
          expect(v.currentVaza?.plays[seat] ?? null).toBeNull();
          expect(v.currentVaza?.covered[seat]).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("F5: desistir da mão (surrender)", () => {
  it("surrender awards the opponent team the current trucoValue (1)", () => {
    const match = createMatch(paulista, 42);
    expect(match.state().hand?.trucoValue).toBe(1);
    const scoresBefore = match.state().scores;

    const r = match.dispatch(0, { type: "surrender" });
    expect(r.success).toBe(true);
    if (r.success) {
      const surrendered = r.events.find((e) => e.type === "surrendered");
      expect(surrendered).toEqual({
        type: "surrendered",
        seat: 0,
        winnerTeam: 1,
        tentos: 1,
      });
      const finished = r.events.find((e) => e.type === "handFinished");
      expect(finished).toMatchObject({
        type: "handFinished",
        winnerTeam: 1,
        tentos: 1,
        reason: "surrender",
      });
    }
    expect(match.state().scores[1]).toBe(scoresBefore[1]! + 1);
  });

  it("surrender with truco accepted at value 6 awards 6", () => {
    const match = createMatch(paulista, 42);
    // Pedido de truco exige estar na vez: seat 0 abre, joga, e a vez passa ao 1.
    match.dispatch(0, { type: "truco", action: "raise" });
    match.dispatch(1, { type: "truco", action: "accept" });
    match.dispatch(
      0,
      match.playerView(0).legalActions.find((a) => a.type === "playCard")!,
    );
    match.dispatch(1, { type: "truco", action: "raise" });
    match.dispatch(2, { type: "truco", action: "accept" });
    expect(match.state().hand?.trucoValue).toBe(6);

    const r = match.dispatch(2, { type: "surrender" });
    expect(r.success).toBe(true);
    if (r.success) {
      const surrendered = r.events.find((e) => e.type === "surrendered");
      expect(surrendered).toMatchObject({ winnerTeam: 1, tentos: 6 });
    }
  });

  it("surrender is rejected while a truco raise is pending", () => {
    const match = createMatch(paulista, 42);
    match.dispatch(0, { type: "truco", action: "raise" });
    const r = match.dispatch(1, { type: "surrender" });
    expect(r).toEqual({ success: false, error: "invalidPhase" });
  });

  it("surrender is accepted even out of turn", () => {
    const match = createMatch(paulista, 42);
    const currentSeat = (match.state().hand!.currentVaza?.currentSeat ??
      match.state().hand!.nextStarter) as Seat;
    const otherSeat = ((currentSeat + 1) % 4) as Seat;
    const r = match.dispatch(otherSeat, { type: "surrender" });
    expect(r.success).toBe(true);
  });

  it("surrender in mão de onze / ferro awards trucoValue 3", () => {
    let found = false;
    for (let seed = 0; seed < 300 && !found; seed++) {
      const match = createMatch(paulista, seed);
      let safety = 0;
      while (
        match.state().phase !== "matchFinished" &&
        !(match.state().hand?.isElevenHand || match.state().hand?.isFerro) &&
        safety < 500
      ) {
        let acted = false;
        for (let s = 0; s < 4; s++) {
          const view = match.playerView(s as Seat);
          const action =
            view.legalActions.find((a) => a.type === "playCard") ??
            view.legalActions.find(
              (a) => a.type === "truco" && a.action === "accept",
            ) ??
            view.legalActions.find((a) => a.type === "elevenDecision");
          if (action) {
            match.dispatch(s as Seat, action);
            acted = true;
            break;
          }
        }
        if (!acted) break;
        safety++;
      }

      // Resolve a decisão de mão de onze (se pendente) escolhendo "play".
      for (let s = 0; s < 4; s++) {
        const view = match.playerView(s as Seat);
        const play = view.legalActions.find(
          (a) => a.type === "elevenDecision" && a.decision === "play",
        );
        if (play) match.dispatch(s as Seat, play);
      }

      const h = match.state().hand;
      if (h && (h.isElevenHand || h.isFerro) && h.trucoValue === 3) {
        const r = match.dispatch(0, { type: "surrender" });
        expect(r.success).toBe(true);
        if (r.success) {
          const surrendered = r.events.find((e) => e.type === "surrendered");
          expect(surrendered).toMatchObject({ tentos: 3 });
        }
        found = true;
      }
    }
    expect(found, "should find a seed reaching mão de onze/ferro").toBe(true);
  });
});
