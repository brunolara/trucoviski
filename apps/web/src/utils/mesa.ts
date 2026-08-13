import type { Card, Seat } from "@trucoviski/shared";

type VazaSlots = {
  plays: readonly (Card | null)[];
  covered: readonly boolean[];
};

/** Número de cartas ainda na mão de um assento, para renderizar os versos. */
export function remainingCardsForSeat(
  view: {
    completedVazas: readonly VazaSlots[];
    currentVaza: VazaSlots | null;
  },
  seat: Seat,
): number {
  const vazas = [
    ...view.completedVazas,
    ...(view.currentVaza ? [view.currentVaza] : []),
  ];
  const playedCards = vazas.filter(
    (vaza) => vaza.plays[seat] !== null || vaza.covered[seat],
  ).length;

  return Math.max(0, 3 - playedCards);
}
