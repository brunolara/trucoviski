import type { CSSProperties, HTMLAttributes } from "react";
import type { Card } from "@trucoviski/shared";
import styles from "./Carta.module.css";

type CartaProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  card?: Card | undefined;
  covered?: boolean;
  manilha?: boolean;
  style?: CSSProperties;
};

/** Colunas de card_fronts: A 2 3 4 5 6 7 8 9 10 J Q K */
const RANK_COL: Record<Card["rank"], number> = {
  A: 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
  "7": 6,
  J: 10,
  Q: 11,
  K: 12,
};

/** Linhas de card_fronts: ouros, paus, copas, espadas */
const SUIT_ROW: Record<Card["suit"], number> = {
  ouros: 0,
  paus: 1,
  copas: 2,
  espadas: 3,
};

/* Geometria de card_fronts.png: folha 926x391, cartas de 68x94 com passo 71x97
   e 3px de margem. O passo não divide a folha em partes iguais, então a conta
   ingênua (i / (n-1)) faz a carta derivar alguns px até a última coluna.
   Mantenha em sincronia com background-size em Carta.module.css. */
const SHEET_W = 926;
const SHEET_H = 391;
const CELL_W = 71;
const CELL_H = 97;
const MARGIN = 3;

function spritePos(index: number, cell: number, sheet: number): string {
  const cells = sheet / cell;
  return `${((index + MARGIN / cell) / (cells - 1)) * 100}%`;
}

/** Carta de truco: frente em pixel art (ouro na manilha) e verso intacto. */
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
          "--face-x": spritePos(RANK_COL[card.rank], CELL_W, SHEET_W),
          "--face-y": spritePos(SUIT_ROW[card.suit], CELL_H, SHEET_H),
        } as CSSProperties)
      : style;

  return (
    <div
      {...props}
      className={`${styles.card} ${covered ? styles.covered : ""} ${showFace ? styles.face : ""} ${showFace && manilha ? styles.faceManilha : ""} ${className ?? ""}`}
      style={faceStyle}
      aria-label={
        ariaLabel ??
        (card && !covered ? `${card.rank} de ${card.suit}` : undefined)
      }
    />
  );
}
