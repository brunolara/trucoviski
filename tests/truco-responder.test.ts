/* ------------------------------------------------------------------ */
/*  Invariante em que o servidor se apoia para destravar o truco        */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- estado da mão garantido pelo cenário */

import { describe, expect, it } from "vitest";
import { createMatch, paulista } from "@trucoviski/engine";
import type { Seat } from "@trucoviski/engine";

function seatsWithTrucoAction(match: ReturnType<typeof createMatch>): Seat[] {
  const seats: Seat[] = [];
  for (let s = 0; s < 4; s++) {
    const view = match.playerView(s as Seat);
    if (view.legalActions.some((a) => a.type === "truco"))
      seats.push(s as Seat);
  }
  return seats;
}

/**
 * TrucoRoom.trucoResponderSeat() varre os 4 assentos procurando quem tem ação
 * de truco. Se mais de um assento respondesse, o servidor despacharia o bot
 * errado; se nenhum respondesse, a mão travaria.
 */
describe("resposta ao truco tem um único responder", () => {
  it("com truco pendente, exatamente um assento recebe accept/run", () => {
    const match = createMatch(paulista, 42);
    const turn = match.state().hand!.nextStarter as Seat;

    const raise = match.dispatch(turn, { type: "truco", action: "raise" });
    expect(raise.success).toBe(true);
    expect(match.state().hand!.trucoPendingTeam).not.toBeNull();

    const responders = seatsWithTrucoAction(match);
    expect(responders).toHaveLength(1);

    // O responder é do time oposto e consegue aceitar.
    const responder = responders[0]!;
    expect(responder % 2).not.toBe(turn % 2);
    expect(
      match.dispatch(responder, { type: "truco", action: "accept" }).success,
    ).toBe(true);
  });

  it("sem truco pendente, nenhum assento fica com accept/run pendurado", () => {
    const match = createMatch(paulista, 42);
    for (const seat of seatsWithTrucoAction(match)) {
      const actions = match
        .playerView(seat)
        .legalActions.filter((a) => a.type === "truco");
      expect(actions.every((a) => a.action === "raise")).toBe(true);
    }
  });
});
