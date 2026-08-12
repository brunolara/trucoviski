/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import type { Card, Seat } from "@trucoviski/shared";
import { EMOJI_WHITELIST } from "@trucoviski/shared";
import { motion, AnimatePresence } from "framer-motion";
import { Carta } from "../components/mesa/Carta.js";
import { cardIsManilha, logLines, seatName } from "../utils/historico.js";
import { remainingCardsForSeat } from "../utils/mesa.js";
import styles from "./Mesa.module.css";

/* ---- Helpers ------------------------------------------------------- */

const RANK_NAMES: Record<string, string> = {
  A: "ás",
  K: "rei",
  J: "valete",
  Q: "dama",
};

function cardAriaLabel(card: Card): string {
  return `Jogar ${RANK_NAMES[card.rank] ?? card.rank} de ${card.suit}`;
}

/** Time 0 = seats 0/2 (azul), time 1 = seats 1/3 (vermelho). */
const TEAM_COLORS: Record<0 | 1, string> = {
  0: "var(--team-blue)",
  1: "var(--team-red)",
};

function seatTeam(s: number): 0 | 1 {
  return s === 0 || s === 2 ? 0 : 1;
}

// ponytail: duplicado da sequência paulista (1→3→6→9→12); importar do
// engine/ruleset se um 2º ruleset com sequência diferente surgir.
const NEXT_TRUCO_VALUE: Record<number, number> = { 1: 3, 3: 6, 6: 9, 9: 12 };
const TRUCO_RAISE_LABEL: Record<number, string> = {
  3: "Truco!",
  6: "Pedir Seis!",
  9: "Pedir Nove!",
  12: "Pedir Doze!",
};

const AVATARS = ["🤠", "👵", "🧔", "👩‍🌾"];

const SEAT_POSITIONS = [
  { left: "50%", bottom: "4%" }, // Seat 0 (bottom) - Me
  { right: "4%", top: "50%" }, // Seat 1 (right)
  { left: "50%", top: "4%" }, // Seat 2 (top) - Partner
  { left: "4%", top: "50%" }, // Seat 3 (left)
];

/** Offset de sweep em direção a cada assento relativo (centro da mesa). */
const SWEEP_DELTA = [
  { x: 0, y: 110 },
  { x: 110, y: 0 },
  { x: 0, y: -110 },
  { x: -110, y: 0 },
];

/* ---- Component ----------------------------------------------------- */

export function Mesa() {
  const screen = useStore((s) => s.screen);
  const room = useStore((s) => s.room);
  const seat = useStore((s) => s.seat);
  const view = useStore((s) => s.view);
  const scores = view?.scores ?? [0, 0];
  const nicknames = useStore((s) => s.nicknames);
  const dispatchAction = useStore((s) => s.dispatchAction);
  const goToHome = useStore((s) => s.goToHome);

  // Social actions/state
  const sendChat = useStore((s) => s.sendChat);
  const sendEmote = useStore((s) => s.sendEmote);
  const throwTomato = useStore((s) => s.throwTomato);
  const chatMessages = useStore((s) => s.chatMessages);
  const emotes = useStore((s) => s.emotes);
  const activeTomato = useStore((s) => s.activeTomato);
  const banner = useStore((s) => s.banner);
  const tableHold = useStore((s) => s.tableHold);
  const skipPresentation = useStore((s) => s.skipPresentation);
  const log = useStore((s) => s.log);

  const [chatInput, setChatInput] = useState("");
  const [showSocialPanel, setShowSocialPanel] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const logBodyRef = useRef<HTMLDivElement>(null);
  const lastCardTap = useRef<Record<number, number>>({});
  const playDispatchGuard = useRef({ snapshotKey: "", isDispatching: false });

  useEffect(() => {
    const updateScale = () => {
      setDesktopScale(
        Math.min(window.innerWidth / 430, window.innerHeight / 932),
      );
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    if (!showLog) return;
    const el = logBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [showLog, log]);

  if (screen !== "mesa") return null;
  if (!view) {
    return (
      <div className={styles.viewport}>
        <div
          className={styles.screen}
          style={{ "--mesa-scale": desktopScale } as React.CSSProperties}
        >
          <p className={styles.waiting}>Carregando partida...</p>
        </div>
      </div>
    );
  }

  const myTeam = seat === 0 || seat === 2 ? 0 : 1;

  const legalPlayCards = view.legalActions.filter((a) => a.type === "playCard");
  const legalPlayHidden = view.legalActions.filter(
    (a) => a.type === "playHiddenCard",
  );
  const legalTrucoActions = view.legalActions.filter((a) => a.type === "truco");
  const elevenDecisions = view.legalActions.filter(
    (a) => a.type === "elevenDecision",
  );
  const canSurrender = view.legalActions.some((a) => a.type === "surrender");
  // surrender é sempre legal na fase playing sem truco pendente — não conta como "sua vez".
  const isMyTurn =
    legalPlayCards.length > 0 ||
    legalPlayHidden.length > 0 ||
    legalTrucoActions.length > 0;

  const turnSeat =
    view.currentVaza?.currentSeat ??
    (legalPlayCards.length > 0 || legalPlayHidden.length > 0 ? seat : null);

  // A resposta do servidor muda a vez, a vaza ou a mão. Até esse próximo
  // snapshot, uma carta só pode gerar um dispatch, mesmo que touch sintetize
  // um dblclick. A contagem de vazas é necessária quando o vencedor continua
  // como mão na próxima vaza.
  const playSnapshotKey = `${view.handNumber}:${view.completedVazas.length}:${turnSeat ?? "none"}`;
  if (playDispatchGuard.current.snapshotKey !== playSnapshotKey) {
    playDispatchGuard.current = {
      snapshotKey: playSnapshotKey,
      isDispatching: false,
    };
  }

  const getRelativeSeat = (absSeat: number) => {
    return (absSeat - seat + 4) % 4;
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      sendChat(chatInput.trim());
      setChatInput("");
      setShowSocialPanel(false);
    }
  };

  const dispatchPlayAction = (
    action:
      | (typeof legalPlayCards)[number]
      | (typeof legalPlayHidden)[number]
      | undefined,
  ) => {
    if (!isMyTurn || !action || playDispatchGuard.current.isDispatching) return;
    playDispatchGuard.current.isDispatching = true;
    dispatchAction(action);
  };

  const playVisibleCard = (card: Card) => {
    const action = legalPlayCards.find(
      (a) =>
        a.type === "playCard" &&
        a.card.rank === card.rank &&
        a.card.suit === card.suit,
    );
    dispatchPlayAction(action);
  };

  const playHiddenCard = (cardIndex: number) => {
    const action = legalPlayHidden.find(
      (a) => a.type === "playHiddenCard" && a.cardIndex === cardIndex,
    );
    dispatchPlayAction(action);
  };

  const handleCardTap = (
    event: React.TouchEvent,
    cardIndex: number,
    play: () => void,
  ) => {
    event.preventDefault();
    const now = Date.now();
    if (now - (lastCardTap.current[cardIndex] ?? 0) < 300) {
      lastCardTap.current[cardIndex] = 0;
      play();
      return;
    }
    lastCardTap.current[cardIndex] = now;
  };

  const handleCardKeyDown = (event: React.KeyboardEvent, play: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    play();
  };

  // Positions on the board for the relative seats
  const relativeSeatsOrder = [0, 1, 2, 3];
  const table = tableHold ?? view.currentVaza;
  const canSkipPresentation = tableHold !== null || banner !== null;
  const holdWinner =
    tableHold && tableHold.winner !== undefined ? tableHold.winner : undefined;
  const sweepDelta =
    tableHold?.sweeping && holdWinner != null
      ? SWEEP_DELTA[getRelativeSeat(holdWinner)]!
      : null;

  return (
    <div className={styles.viewport}>
      <div
        className={styles.screen}
        style={{ "--mesa-scale": desktopScale } as React.CSSProperties}
        data-testid="mesa-screen"
        data-room-id={room?.roomId ?? ""}
        onPointerDown={
          canSkipPresentation
            ? () => {
                skipPresentation();
              }
            : undefined
        }
      >
        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.scores} data-testid="scoreboard">
            <span
              className={styles.teamScore}
              style={{ color: TEAM_COLORS[0] }}
              data-testid="score-team-0"
            >
              <span
                className={styles.teamDot}
                style={{ background: TEAM_COLORS[0] }}
              />
              <span className={styles.scoreNumber}>{scores[0]}</span>
            </span>
            <span className={styles.divider}>×</span>
            <span
              className={styles.teamScore}
              style={{ color: TEAM_COLORS[1] }}
              data-testid="score-team-1"
            >
              <span
                className={styles.teamDot}
                style={{ background: TEAM_COLORS[1] }}
              />
              <span className={styles.scoreNumber}>{scores[1]}</span>
            </span>
          </div>
          <div className={styles.viraTop} data-testid="round-info">
            <span>Vira</span>
            <motion.div
              className={styles.viraCard}
              initial={{ scale: 0, rotateY: 180 }}
              animate={{ scale: 1, rotateY: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              <Carta card={view.vira} />
            </motion.div>
          </div>
        </div>

        {/* Board area (circular 2D). O alerta de truco e os botões de ação
            flutuam sobre a mesa em vez de empurrar o layout. */}
        <div className={styles.boardStack}>
          <div className={styles.board}>
            <img
              className={styles.tableDecorationHat}
              src="/assets/pixel/chapeu.png"
              alt=""
              aria-hidden="true"
            />
            <img
              className={styles.tableDecorationGun}
              src="/assets/pixel/arma.png"
              alt=""
              aria-hidden="true"
            />
            {/* Table Center */}
            <div className={styles.tableCenter}>
              {/* Current plays arranged cross-wise (ou congeladas via tableHold) */}
              {table && (
                <div className={styles.playedCardsGrid}>
                  {table.plays.map((c, absSeat) => {
                    const rel = getRelativeSeat(absSeat);
                    const isCovered = table.covered[absSeat];
                    const isWinner =
                      holdWinner !== undefined && holdWinner === absSeat;
                    const isDimmed =
                      holdWinner !== undefined &&
                      holdWinner !== null &&
                      holdWinner !== absSeat;
                    return (
                      <div
                        key={absSeat}
                        className={`${styles.playedCardWrapper} ${styles[`playPos${rel}`]}`}
                        data-testid={`played-card-${absSeat}`}
                        data-winner={isWinner ? "true" : undefined}
                      >
                        <AnimatePresence mode="wait">
                          {isCovered ? (
                            <motion.div
                              className={`${styles.playedCard} ${isWinner ? styles.playedCardWinner : ""} ${isDimmed ? styles.playedCardDimmed : ""}`}
                              style={
                                isWinner
                                  ? {
                                      outlineColor:
                                        TEAM_COLORS[seatTeam(absSeat)],
                                    }
                                  : {}
                              }
                              initial={{ scale: 0.5 }}
                              animate={
                                tableHold?.sweeping
                                  ? {
                                      scale: 0.6,
                                      opacity: 0,
                                      x: sweepDelta?.x ?? 0,
                                      y: sweepDelta?.y ?? 0,
                                    }
                                  : {
                                      scale: isWinner ? 1.12 : 1,
                                      opacity: isDimmed ? 0.4 : 1,
                                      x: 0,
                                      y: 0,
                                    }
                              }
                              exit={{ scale: 0 }}
                              transition={
                                tableHold?.sweeping
                                  ? { type: "tween", duration: 0.28 }
                                  : {
                                      type: "spring",
                                      stiffness: 300,
                                      damping: 20,
                                    }
                              }
                              title="Carta coberta"
                            >
                              <Carta covered />
                            </motion.div>
                          ) : c ? (
                            <motion.div
                              className={`${styles.playedCard} ${isWinner ? styles.playedCardWinner : ""} ${isDimmed ? styles.playedCardDimmed : ""}`}
                              style={
                                isWinner
                                  ? {
                                      outlineColor:
                                        TEAM_COLORS[seatTeam(absSeat)],
                                    }
                                  : {}
                              }
                              initial={{
                                scale: 0.5,
                                y: rel === 0 ? 30 : rel === 2 ? -30 : 0,
                                x: rel === 3 ? -30 : rel === 1 ? 30 : 0,
                              }}
                              animate={
                                tableHold?.sweeping
                                  ? {
                                      scale: 0.6,
                                      opacity: 0,
                                      x: sweepDelta?.x ?? 0,
                                      y: sweepDelta?.y ?? 0,
                                    }
                                  : {
                                      scale: isWinner ? 1.12 : 1,
                                      opacity: isDimmed ? 0.4 : 1,
                                      x: 0,
                                      y: 0,
                                    }
                              }
                              exit={{ scale: 0 }}
                              transition={
                                tableHold?.sweeping
                                  ? { type: "tween", duration: 0.28 }
                                  : {
                                      type: "spring",
                                      stiffness: 300,
                                      damping: 20,
                                    }
                              }
                            >
                              <Carta
                                card={c}
                                manilha={cardIsManilha(c, view.vira)}
                              />
                            </motion.div>
                          ) : (
                            <div className={styles.playedCardEmpty}>
                              <span>
                                {seatName(nicknames, absSeat).slice(0, 3)}
                              </span>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Players Seats */}
            {relativeSeatsOrder.map((relSeat) => {
              const absSeat = ((seat + relSeat) % 4) as Seat;
              const remainingCards = remainingCardsForSeat(view, absSeat);
              const pos = SEAT_POSITIONS[relSeat]!;
              const isTurn =
                holdWinner !== undefined
                  ? holdWinner === absSeat
                  : turnSeat === absSeat;
              const name = seatName(nicknames, absSeat);
              const isMe = relSeat === 0;

              // Chat message
              const chat = chatMessages[absSeat];
              // Emote
              const emote = emotes[absSeat];
              return (
                <div
                  key={relSeat}
                  className={`${styles.seat} ${styles[`seat${relSeat}`]}`}
                  data-testid={`seat-${absSeat}`}
                  style={{
                    position: "absolute",
                    left: pos.left,
                    top: pos.top,
                    bottom: pos.bottom,
                    right: pos.right,
                    transform:
                      relSeat === 0 || relSeat === 2
                        ? "translateX(-50%)"
                        : "translateY(-50%)",
                  }}
                >
                  {!isMe && !(relSeat === 2 && view.partnerCards?.length) && (
                    <div className={styles.seatCardBacks} aria-hidden="true">
                      {Array.from({ length: remainingCards }, (_, index) => (
                        <Carta covered key={index} />
                      ))}
                    </div>
                  )}
                  {/* Avatar circle */}
                  <div
                    className={`${styles.avatar} ${isTurn ? styles.activeAvatar : ""} ${
                      (
                        holdWinner !== undefined
                          ? holdWinner !== null && !isTurn
                          : turnSeat !== null && !isTurn
                      )
                        ? styles.dimmedAvatar
                        : ""
                    }`}
                    style={{ borderColor: TEAM_COLORS[seatTeam(absSeat)] }}
                  >
                    <span className={styles.avatarLabel}>
                      {AVATARS[absSeat]}
                    </span>
                    {/* 🍅 button for others */}
                    {!isMe && (
                      <button
                        className={styles.tomatoBtn}
                        onClick={() => throwTomato(absSeat)}
                        title={`Jogar tomate em ${name}`}
                        data-testid={`tomato-btn-${absSeat}`}
                      >
                        🍅
                      </button>
                    )}
                  </div>

                  {/* Player nickname */}
                  <div className={styles.seatName}>
                    {name} {isMe && "(Você)"}
                  </div>

                  {/* Chat bubble */}
                  <AnimatePresence>
                    {chat && (
                      <motion.div
                        className={styles.chatBubble}
                        data-testid={`chat-bubble-${absSeat}`}
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                      >
                        {chat.text}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Emote display */}
                  <AnimatePresence>
                    {emote && (
                      <motion.div
                        className={styles.emoteBubble}
                        data-testid={`emote-bubble-${absSeat}`}
                        initial={{ opacity: 0, y: 10, scale: 0.5 }}
                        animate={{ opacity: 1, y: -20, scale: 1.5 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{
                          type: "spring",
                          stiffness: 200,
                          damping: 10,
                        }}
                      >
                        {emote.emoji}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Partner Cards display on top seat (Seat 2) if in Mão de Onze */}
                  {relSeat === 2 &&
                    view.partnerCards &&
                    view.partnerCards.length > 0 && (
                      <div className={styles.partnerCardsContainer}>
                        {view.partnerCards.map((pc, idx) => (
                          <div key={idx} className={styles.partnerMiniCard}>
                            <Carta
                              card={pc}
                              manilha={cardIsManilha(pc, view.vira)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              );
            })}

            {/* Flying Tomatoes */}
            {activeTomato &&
              (() => {
                const fromRel = getRelativeSeat(activeTomato.senderSeat);
                const toRel = getRelativeSeat(activeTomato.targetSeat);
                const fromPos = SEAT_POSITIONS[fromRel]!;
                const toPos = SEAT_POSITIONS[toRel]!;

                return (
                  <motion.div
                    className={styles.tomatoEffect}
                    data-testid="tomato-effect"
                    initial={{
                      left: fromPos.left || "auto",
                      top: fromPos.top || "auto",
                      bottom: fromPos.bottom || "auto",
                      right: fromPos.right || "auto",
                      scale: 0.8,
                      x: fromRel === 0 || fromRel === 2 ? "-50%" : "0%",
                      y: fromRel === 1 || fromRel === 3 ? "-50%" : "0%",
                    }}
                    animate={
                      activeTomato.phase === "flying"
                        ? {
                            left: toPos.left || "auto",
                            top: toPos.top || "auto",
                            bottom: toPos.bottom || "auto",
                            right: toPos.right || "auto",
                            scale: 1.3,
                            x: toRel === 0 || toRel === 2 ? "-50%" : "0%",
                            y: toRel === 1 || toRel === 3 ? "-50%" : "0%",
                          }
                        : {
                            left: toPos.left || "auto",
                            top: toPos.top || "auto",
                            bottom: toPos.bottom || "auto",
                            right: toPos.right || "auto",
                            scale: [1, 2.2, 1.4],
                            rotate: [0, 20, -20, 0],
                            x: toRel === 0 || toRel === 2 ? "-50%" : "0%",
                            y: toRel === 1 || toRel === 3 ? "-50%" : "0%",
                          }
                    }
                    transition={{
                      duration: activeTomato.phase === "flying" ? 0.5 : 0.2,
                    }}
                  >
                    {activeTomato.phase === "flying" ? "🍅" : "💥🍅💦"}
                  </motion.div>
                );
              })()}
          </div>

          {/* Truco pendente: sobreposto ao topo da mesa. O banner de
              apresentação já narra o pedido — não duplicar enquanto ele existe. */}
          {view.trucoPendingTeam !== null && !banner && (
            <div
              className={styles.trucoAlert}
              style={{
                borderColor: TEAM_COLORS[view.trucoPendingTeam],
                color: TEAM_COLORS[view.trucoPendingTeam],
              }}
            >
              {view.trucoPendingTeam === myTeam
                ? `Seu time pediu ${view.trucoPendingValue}!`
                : `Oponentes pediram ${view.trucoPendingValue}!`}
            </div>
          )}

          {/* Ações da mão: sobrepostas à base da mesa */}
          <div className={styles.gameActions}>
            {elevenDecisions.length > 0 && (
              <div
                className={styles.elevenBox}
                data-testid="eleven-decision-box"
              >
                <p className={styles.elevenText}>Mão de Onze! Decida:</p>
                <div className={styles.elevenBtns}>
                  {elevenDecisions.map((a) => (
                    <button
                      key={a.decision}
                      className={
                        a.decision === "play" ? styles.playBtn : styles.runBtn
                      }
                      onClick={() => dispatchAction(a)}
                      data-testid={
                        a.decision === "play"
                          ? "eleven-play-btn"
                          : "eleven-run-btn"
                      }
                    >
                      {a.decision === "play" ? "Jogar (vale 3)" : "Correr (+1)"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isMyTurn && legalTrucoActions.length > 0 && (
              <div className={styles.actionArea} data-testid="action-area">
                <div className={styles.trucoActions}>
                  {legalTrucoActions.map((a, i) => {
                    const trucoAction = (a as { action: string }).action;
                    let label: string = trucoAction;
                    if (trucoAction === "raise") {
                      const base = view.trucoPendingValue ?? view.trucoValue;
                      const next = NEXT_TRUCO_VALUE[base];
                      label = next
                        ? (TRUCO_RAISE_LABEL[next] ?? "Truco!")
                        : "Truco!";
                    }
                    if (trucoAction === "accept") {
                      label = `Aceitar (vale ${view.trucoPendingValue})`;
                    }
                    if (trucoAction === "run") label = "Correr";
                    return (
                      <button
                        key={i}
                        className={
                          trucoAction === "raise"
                            ? styles.trucoBtn
                            : trucoAction === "accept"
                              ? styles.acceptBtn
                              : styles.runBtn
                        }
                        onClick={() => dispatchAction(a)}
                        data-testid={`truco-${trucoAction}-btn`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Faixa de status: altura fixa para a mesa não mudar de tamanho */}
        <div className={styles.statusStrip}>
          {turnSeat !== null && (
            <p className={styles.turnIndicatorText}>
              {turnSeat === seat
                ? "▶ SUA VEZ DE JOGAR!"
                : `Vez de: ${seatName(nicknames, turnSeat)}`}
            </p>
          )}
        </div>

        {/* Presentation banner (pacing) */}
        <AnimatePresence>
          {banner && (
            <motion.div
              className={styles.presentationBanner}
              style={
                banner.team !== undefined
                  ? {
                      borderColor: TEAM_COLORS[banner.team],
                      color: TEAM_COLORS[banner.team],
                    }
                  : {}
              }
              initial={{ opacity: 0, y: -10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              data-testid="presentation-banner"
            >
              {banner.text}
              {canSkipPresentation && (
                <span className={styles.skipHint} data-testid="skip-hint">
                  toque para pular
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completed vazas */}
        <div className={styles.vazasArea}>
          {view.completedVazas.map((v, i) => (
            <div key={i} className={styles.vazaRow}>
              <span className={styles.vazaWinner}>
                Vaza {i + 1}:{" "}
                {v.winner !== null ? seatName(nicknames, v.winner) : "canga"} →
              </span>
              {v.plays.map((c, si) => (
                <Carta
                  card={c ?? undefined}
                  covered={!c}
                  manilha={c ? cardIsManilha(c, view.vira) : false}
                  key={si}
                  className={styles.miniCard}
                  aria-label={c ? `${c.rank} de ${c.suit}` : "Carta coberta"}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Hand Area (Your Cards) */}
        <div
          className={`${styles.handArea} ${turnSeat === seat ? styles.handAreaActive : ""}`}
        >
          <p className={styles.handLabel}>
            {view.isFerro ? "Suas cartas (cobertas - Ferro!)" : "Suas cartas"}
          </p>
          <div className={styles.hand} data-testid="hand-area">
            {view.isFerro
              ? Array.from({ length: legalPlayHidden.length }, (_, i) => (
                  <motion.div
                    key={i}
                    className={styles.handCardWrapper}
                    whileHover={{ y: -12, scale: 1.06 }}
                    initial={{ scale: 0, y: 30 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    drag={isMyTurn && legalPlayHidden.length > 0}
                    dragConstraints={{
                      left: 0,
                      right: 0,
                      top: -100,
                      bottom: 0,
                    }}
                    dragElastic={0.2}
                    onDragEnd={(_e, info) => {
                      if (info.offset.y < -50) {
                        playHiddenCard(i);
                      }
                    }}
                  >
                    <Carta
                      covered
                      className={styles.ferroCard}
                      data-testid={`hand-card-${i}`}
                      onDoubleClick={() => playHiddenCard(i)}
                      onTouchEnd={(event) =>
                        handleCardTap(event, i, () => playHiddenCard(i))
                      }
                      onKeyDown={(event) =>
                        handleCardKeyDown(event, () => playHiddenCard(i))
                      }
                      role="button"
                      tabIndex={0}
                      aria-label="Jogar carta coberta"
                      aria-disabled={
                        !legalPlayHidden.some(
                          (action) =>
                            action.type === "playHiddenCard" &&
                            action.cardIndex === i,
                        )
                      }
                    />
                  </motion.div>
                ))
              : view.handCards.map((c, i) => (
                  <motion.div
                    key={i}
                    className={styles.handCardWrapper}
                    whileHover={{ y: -12, scale: 1.06 }}
                    initial={{ scale: 0, y: 30 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    drag={isMyTurn && legalPlayCards.length > 0}
                    dragConstraints={{
                      left: 0,
                      right: 0,
                      top: -100,
                      bottom: 0,
                    }}
                    dragElastic={0.2}
                    onDragEnd={(_e, info) => {
                      if (info.offset.y < -50) {
                        playVisibleCard(c);
                      }
                    }}
                  >
                    <Carta
                      card={c}
                      manilha={cardIsManilha(c, view.vira)}
                      className={styles.handCard}
                      data-testid={`hand-card-${i}`}
                      onDoubleClick={() => playVisibleCard(c)}
                      onTouchEnd={(event) =>
                        handleCardTap(event, i, () => playVisibleCard(c))
                      }
                      onKeyDown={(event) =>
                        handleCardKeyDown(event, () => playVisibleCard(c))
                      }
                      role="button"
                      tabIndex={0}
                      aria-label={cardAriaLabel(c)}
                      aria-disabled={
                        !legalPlayCards.some(
                          (action) =>
                            action.type === "playCard" &&
                            action.card.rank === c.rank &&
                            action.card.suit === c.suit,
                        )
                      }
                    />
                    {cardIsManilha(c, view.vira) && (
                      <span className={styles.manilhaBadge}>Manilha</span>
                    )}
                    {isMyTurn && (
                      <div className={styles.cardControls}>
                        {legalPlayHidden.some(
                          (a) =>
                            a.type === "playHiddenCard" && a.cardIndex === i,
                        ) && (
                          <button
                            className={styles.coverBtn}
                            onClick={() => playHiddenCard(i)}
                            title="Jogar esta carta coberta (nunca vence a vaza)"
                            data-testid={`cover-card-btn-${i}`}
                          >
                            Virar coberta
                          </button>
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <div className={styles.footer}>
            <button
              type="button"
              className={styles.utilBtn}
              onClick={() => setShowLog(true)}
              data-testid="log-toggle-btn"
            >
              📜 Histórico
            </button>
            <button
              type="button"
              className={styles.utilBtn}
              onClick={() => setShowSocialPanel(true)}
              data-testid="social-toggle-btn"
            >
              💬 Social
            </button>
            {canSurrender && (
              <button
                type="button"
                className={styles.utilBtn}
                data-testid="surrender-btn"
                onClick={() => {
                  const surrenderAction = view.legalActions.find(
                    (a) => a.type === "surrender",
                  );
                  if (!surrenderAction) return;
                  const confirmed = window.confirm(
                    `Desistir da mão? O adversário ganha ${view.trucoValue} tento(s).`,
                  );
                  if (confirmed) dispatchAction(surrenderAction);
                }}
              >
                🏳️ Desistir
              </button>
            )}
            <button type="button" className={styles.utilBtn} onClick={goToHome}>
              🚪 Sair
            </button>
          </div>
        </div>

        {showSocialPanel && (
          <div
            className={styles.socialOverlay}
            role="presentation"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setShowSocialPanel(false);
            }}
          >
            <div
              className={styles.socialPanel}
              role="dialog"
              aria-modal="true"
              aria-label="Chat e emojis"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") setShowSocialPanel(false);
              }}
              onClick={(e) => e.stopPropagation()}
              data-testid="social-panel"
            >
              <div className={styles.socialPanelHeader}>
                <strong>Social</strong>
                <button
                  type="button"
                  className={styles.socialCloseBtn}
                  onClick={() => setShowSocialPanel(false)}
                  aria-label="Fechar painel social"
                  data-testid="social-close-btn"
                  autoFocus
                >
                  ×
                </button>
              </div>
              <div className={styles.emojiPicker}>
                {EMOJI_WHITELIST.map((emoji) => (
                  <button
                    key={emoji}
                    className={styles.emojiBtn}
                    onClick={() => {
                      sendEmote(emoji);
                      setShowSocialPanel(false);
                    }}
                    data-testid={`emoji-btn-${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form className={styles.chatForm} onSubmit={handleSendChat}>
                <input
                  type="text"
                  className={styles.chatInput}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Digite provocação..."
                  maxLength={120}
                  data-testid="chat-input"
                />
                <button
                  type="submit"
                  className={styles.chatSubmitBtn}
                  data-testid="chat-submit-btn"
                >
                  Enviar
                </button>
              </form>
            </div>
          </div>
        )}

        {showLog && (
          <div
            className={styles.socialOverlay}
            role="presentation"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setShowLog(false);
            }}
          >
            <div
              className={styles.logPanel}
              role="dialog"
              aria-modal="true"
              aria-label="Histórico da partida"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") setShowLog(false);
              }}
              onClick={(e) => e.stopPropagation()}
              data-testid="log-panel"
            >
              <div className={styles.socialPanelHeader}>
                <strong>Histórico</strong>
                <button
                  type="button"
                  className={styles.socialCloseBtn}
                  onClick={() => setShowLog(false)}
                  aria-label="Fechar histórico"
                  data-testid="log-close-btn"
                  autoFocus
                >
                  ×
                </button>
              </div>
              <div className={styles.logBody} ref={logBodyRef}>
                {logLines(log, nicknames).map((line, i) =>
                  line.divider ? (
                    <h3 key={i} className={styles.logHand}>
                      {line.text}
                    </h3>
                  ) : (
                    <div
                      key={i}
                      className={styles.logLine}
                      style={
                        line.team !== undefined
                          ? { color: TEAM_COLORS[line.team] }
                          : undefined
                      }
                    >
                      <time className={styles.logTime} dateTime={line.time}>
                        {line.time}
                      </time>
                      <span>{line.text}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
