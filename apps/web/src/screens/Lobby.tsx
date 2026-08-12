import { useState, type DragEvent } from "react";
import { formatRoomCode } from "@trucoviski/shared";
import { useStore } from "../store.js";
import styles from "./Lobby.module.css";

const TEAM_SEATS: readonly (readonly number[])[] = [
  [0, 2],
  [1, 3],
];

function seatTeam(s: number): 0 | 1 {
  return (s % 2) as 0 | 1;
}

export function Lobby() {
  const screen = useStore((s) => s.screen);
  const connectedPlayers = useStore((s) => s.connectedPlayers);
  const seat = useStore((s) => s.seat);
  const isOwner = useStore((s) => s.isOwner);
  const nicknames = useStore((s) => s.nicknames);
  const botSeats = useStore((s) => s.botSeats);
  const room = useStore((s) => s.room);
  const fillBots = useStore((s) => s.fillBots);
  const startGame = useStore((s) => s.startGame);
  const swapSeats = useStore((s) => s.swapSeats);
  const goToHome = useStore((s) => s.goToHome);

  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [dragSeat, setDragSeat] = useState<number | null>(null);

  if (screen !== "lobby") return null;

  const roomId = room?.roomId ?? "";
  const myTeam = seat >= 0 ? seatTeam(seat) : null;
  const botSet = new Set(botSeats);
  const missing = Math.max(0, 4 - connectedPlayers);

  function seatLabel(s: number): {
    name: string;
    kind: "human" | "bot" | "empty";
  } {
    const name = nicknames[s];
    if (!name) return { name: "Vago", kind: "empty" };
    if (botSet.has(s)) return { name, kind: "bot" };
    return { name, kind: "human" };
  }

  function onSeatClick(s: number): void {
    if (!isOwner) return;
    if (selectedSeat === null) {
      setSelectedSeat(s);
      return;
    }
    if (selectedSeat === s) {
      setSelectedSeat(null);
      return;
    }
    swapSeats(selectedSeat, s);
    setSelectedSeat(null);
  }

  function onDragStart(s: number, e: DragEvent): void {
    if (!isOwner) {
      e.preventDefault();
      return;
    }
    setDragSeat(s);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(s));
  }

  function onDragOver(e: DragEvent): void {
    if (!isOwner) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(target: number, e: DragEvent): void {
    if (!isOwner) return;
    e.preventDefault();
    const from =
      dragSeat ??
      Number.parseInt(e.dataTransfer.getData("text/plain") || "", 10);
    setDragSeat(null);
    if (!Number.isInteger(from) || from === target) return;
    swapSeats(from, target);
    setSelectedSeat(null);
  }

  return (
    <div className={styles.screen} data-testid="lobby-screen">
      <div className={styles.card}>
        <h2 className={styles.title}>Sala de Espera</h2>

        <div className={styles.info}>
          <p>
            Código:{" "}
            <strong data-testid="room-code">{formatRoomCode(roomId)}</strong>
          </p>
          <p data-testid="player-count">Jogadores: {connectedPlayers} / 4</p>
        </div>

        <div className={styles.teams}>
          {TEAM_SEATS.map((seats, team) => (
            <div
              key={team}
              className={`${styles.team} ${team === 0 ? styles.teamBlue : styles.teamRed}`}
              data-testid={`lobby-team-${team}`}
            >
              <div className={styles.teamHeader}>
                <span className={styles.teamDot} aria-hidden="true" />
                <span className={styles.teamLabel}>
                  {team === 0 ? "TIME AZUL" : "TIME VERMELHO"}
                  {myTeam === team ? " (Nós)" : ""}
                </span>
              </div>
              {seats.map((s) => {
                const { name, kind } = seatLabel(s);
                const selected = selectedSeat === s;
                return (
                  <div
                    key={s}
                    className={[
                      styles.seat,
                      s === seat ? styles.mySeat : "",
                      kind === "empty" ? styles.emptySeat : "",
                      selected ? styles.selectedSeat : "",
                      isOwner ? styles.interactive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-testid={`lobby-seat-${s}`}
                    role={isOwner ? "button" : undefined}
                    tabIndex={isOwner ? 0 : undefined}
                    draggable={isOwner}
                    onClick={() => onSeatClick(s)}
                    onKeyDown={(e) => {
                      if (!isOwner) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSeatClick(s);
                      }
                    }}
                    onDragStart={(e) => onDragStart(s, e)}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(s, e)}
                    onDragEnd={() => setDragSeat(null)}
                  >
                    <span className={styles.seatNum}>S{s + 1}</span>
                    <span className={styles.seatName}>{name}</span>
                    {s === seat && <span className={styles.you}>(você)</span>}
                    {kind === "bot" && (
                      <span className={styles.botBadge} aria-label="bot">
                        🤖
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {isOwner ? (
          <p className={styles.hint}>
            Toque em dois assentos (ou arraste) para organizar as duplas.
          </p>
        ) : (
          <p className={styles.hint}>
            Só o dono organiza as duplas e começa a partida.
          </p>
        )}

        {connectedPlayers < 4 && (
          <p className={styles.hint}>
            {isOwner
              ? `Faltam ${missing} jogadores — ou preencha com bots`
              : "Aguardando mais jogadores..."}
          </p>
        )}

        {!isOwner && connectedPlayers >= 4 && (
          <p className={styles.hint}>Aguardando o dono começar...</p>
        )}

        <div className={styles.actions}>
          {isOwner && connectedPlayers < 4 && (
            <button
              className={styles.fillBtn}
              onClick={fillBots}
              data-testid="fill-bots-btn"
            >
              Preencher com Bots
            </button>
          )}
          {isOwner && (
            <button
              className={styles.startBtn}
              onClick={startGame}
              disabled={connectedPlayers < 4}
              data-testid="start-btn"
            >
              Começar
            </button>
          )}
          <button
            className={styles.leaveBtn}
            onClick={goToHome}
            data-testid="leave-btn"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
