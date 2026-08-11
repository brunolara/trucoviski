import type { PlayerView, Seat } from "@trucoviski/shared";

/** Número de cartas ainda na mão de um assento, para renderizar os versos. */
export function remainingCardsForSeat(
  view: Pick<PlayerView, "completedVazas" | "currentVaza">,
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
