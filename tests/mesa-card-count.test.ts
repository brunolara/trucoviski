import { describe, expect, it } from "vitest";
import type { PlayerView } from "@trucoviski/shared";
import { remainingCardsForSeat } from "../apps/web/src/utils/mesa.js";

const CARD = { rank: "A", suit: "paus" } as const;
type Vaza = NonNullable<PlayerView["currentVaza"]>;

function vaza(plays: Vaza["plays"], covered: Vaza["covered"]): Vaza {
  return { plays, covered, currentSeat: 0 };
}

describe("remainingCardsForSeat", () => {
  it("starts each opponent with three card backs", () => {
    expect(
      remainingCardsForSeat({ completedVazas: [], currentVaza: null }, 1),
    ).toBe(3);
  });

  it("removes a back after a visible or covered current-vaza play", () => {
    expect(
      remainingCardsForSeat(
        {
          completedVazas: [],
          currentVaza: vaza(
            [null, CARD, null, null],
            [false, false, false, false],
          ),
        },
        1,
      ),
    ).toBe(2);
    expect(
      remainingCardsForSeat(
        {
          completedVazas: [],
          currentVaza: vaza(
            [null, null, null, null],
            [false, false, true, false],
          ),
        },
        2,
      ),
    ).toBe(2);
  });

  it("keeps the count reduced after a completed vaza", () => {
    expect(
      remainingCardsForSeat(
        {
          completedVazas: [
            {
              plays: [CARD, CARD, CARD, CARD],
              covered: [false, false, false, false],
              winner: 0,
              tiedSeats: [],
            },
          ],
          currentVaza: null,
        },
        3,
      ),
    ).toBe(2);
  });

  it("counts a tableHold vaza the same as currentVaza", () => {
    expect(
      remainingCardsForSeat(
        {
          completedVazas: [
            {
              plays: [CARD, CARD, CARD, CARD],
              covered: [false, false, false, false],
            },
          ],
          currentVaza: {
            plays: [CARD, CARD, CARD, CARD],
            covered: [false, false, false, false],
          },
        },
        1,
      ),
    ).toBe(1);
  });
});
