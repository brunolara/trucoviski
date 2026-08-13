import type { CSSProperties, HTMLAttributes } from "react";
import type { Card } from "@trucoviski/shared";
import styles from "./Carta.module.css";

type CartaProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  card?: Card | undefined;
  covered?: boolean;
  manilha?: boolean;
  style?: CSSProperties;
};

const SUIT_DISPLAY: Record<Card["suit"], { symbol: string; color: string }> = {
  ouros: { symbol: "♦", color: "#c8261f" },
  paus: { symbol: "♣", color: "#181008" },
  copas: { symbol: "♥", color: "#c8261f" },
  espadas: { symbol: "♠", color: "#181008" },
};

/** Carta de truco: frente nítida e verso em pixel art. */
export function Carta({
  card,
  covered = false,
  manilha = false,
  className,
  style,
  "aria-label": ariaLabel,
  ...props
}: CartaProps) {
  const suit = card ? SUIT_DISPLAY[card.suit] : undefined;

  return (
    <div
      {...props}
      className={`${styles.card} ${covered ? styles.covered : ""} ${manilha && !covered ? styles.manilha : ""} ${className ?? ""}`}
      style={style}
      aria-label={
        ariaLabel ??
        (card && !covered ? `${card.rank} de ${card.suit}` : undefined)
      }
    >
      {card && !covered && suit && (
        <>
          <span
            className={styles.corner}
            style={{ color: suit.color }}
            aria-hidden="true"
          >
            {card.rank}
            {suit.symbol}
          </span>
          <span
            className={styles.suit}
            style={{ color: suit.color }}
            aria-hidden="true"
          >
            {suit.symbol}
          </span>
          <span
            className={styles.cornerBottom}
            style={{ color: suit.color }}
            aria-hidden="true"
          >
            {card.rank}
            {suit.symbol}
          </span>
        </>
      )}
    </div>
  );
}
