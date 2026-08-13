import type { CSSProperties, HTMLAttributes } from "react";
import type { Card } from "@trucoviski/shared";
import styles from "./Carta.module.css";

type CartaProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  card?: Card | undefined;
  covered?: boolean;
  manilha?: boolean;
  style?: CSSProperties;
};

/** Colunas do 8BitDeck: 2 3 4 5 6 7 8 9 10 J Q K A */
const RANK_COL: Record<Card["rank"], number> = {
  "2": 0,
  "3": 1,
  "4": 2,
  "5": 3,
  "6": 4,
  "7": 5,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
};

/** Linhas do 8BitDeck: copas, paus, ouros, espadas */
const SUIT_ROW: Record<Card["suit"], number> = {
  copas: 0,
  paus: 1,
  ouros: 2,
  espadas: 3,
};

const FACE_COLS = 13;
const FACE_ROWS = 4;
const BASE_COLS = 7;
const BASE_ROWS = 5;
const BASE_WHITE_COL = 1;
const BASE_GOLD_COL = 6;

function spritePos(index: number, count: number): string {
  if (count <= 1) return "0%";
  return `${(index / (count - 1)) * 100}%`;
}

/** Carta de truco: frente em pixel art (base + face) e verso intacto. */
export function Carta({
  card,
  covered = false,
  manilha = false,
  className,
  style,
  "aria-label": ariaLabel,
  ...props
}: CartaProps) {
  const showFace = Boolean(card) && !covered;
  const faceStyle: CSSProperties | undefined =
    showFace && card
      ? ({
          ...style,
          "--face-x": spritePos(RANK_COL[card.rank], FACE_COLS),
          "--face-y": spritePos(SUIT_ROW[card.suit], FACE_ROWS),
          "--base-x": spritePos(
            manilha ? BASE_GOLD_COL : BASE_WHITE_COL,
            BASE_COLS,
          ),
          "--base-y": spritePos(0, BASE_ROWS),
        } as CSSProperties)
      : style;

  return (
    <div
      {...props}
      className={`${styles.card} ${covered ? styles.covered : ""} ${showFace ? styles.face : ""} ${className ?? ""}`}
      style={faceStyle}
      aria-label={
        ariaLabel ??
        (card && !covered ? `${card.rank} de ${card.suit}` : undefined)
      }
    />
  );
}
