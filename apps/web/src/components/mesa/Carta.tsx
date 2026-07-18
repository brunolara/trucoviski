import type { CSSProperties, HTMLAttributes } from "react";
import type { Card } from "@trucoviski/shared";
import styles from "./Carta.module.css";

type CartaProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  card?: Card | undefined;
  covered?: boolean;
  style?: CSSProperties;
};

const RANK_COLUMNS: Record<Card["rank"], number> = {
  A: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  J: 10,
  Q: 11,
  K: 12,
};

const SUIT_ROWS: Record<Card["suit"], number> = {
  ouros: 0,
  paus: 1,
  copas: 2,
  espadas: 3,
};

/** Carta do spritesheet Pixel Art (68 × 94 px por carta). */
export function Carta({
  card,
  covered = false,
  className,
  style,
  ...props
}: CartaProps) {
  const spriteStyle = covered
    ? { "--card-position-x": "1.875%", "--card-position-y": "97.196%" }
    : card
      ? {
          "--card-position-x": `${((3 + RANK_COLUMNS[card.rank] * 71) / 858) * 100}%`,
          "--card-position-y": `${((3 + SUIT_ROWS[card.suit] * 97) / 297) * 100}%`,
        }
      : {};

  return (
    <div
      {...props}
      className={`${styles.card} ${covered ? styles.covered : ""} ${className ?? ""}`}
      style={{ ...spriteStyle, ...style } as CSSProperties}
    />
  );
}
