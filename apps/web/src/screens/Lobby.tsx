import { useStore } from "../store.js";
import styles from "./Lobby.module.css";

export function Lobby() {
  const screen = useStore((s) => s.screen);
  const connectedPlayers = useStore((s) => s.connectedPlayers);
  const seat = useStore((s) => s.seat);
  const isOwner = useStore((s) => s.isOwner);
  const nicknames = useStore((s) => s.nicknames);
  const room = useStore((s) => s.room);
  const fillBots = useStore((s) => s.fillBots);
  const goToHome = useStore((s) => s.goToHome);

  if (screen !== "lobby") return null;

  const roomId = room?.roomId ?? "";

  return (
    <div className={styles.screen} data-testid="lobby-screen">
      <div className={styles.card}>
        <h2 className={styles.title}>Sala de Espera</h2>

        <div className={styles.info}>
          <p>
            Código: <strong data-testid="room-code">{roomId}</strong>
          </p>
          <p data-testid="player-count">Jogadores: {connectedPlayers} / 4</p>
        </div>

        <div className={styles.seats}>
          {[0, 1, 2, 3].map((s) => (
            <div
              key={s}
              className={`${styles.seat} ${s === seat ? styles.mySeat : ""}`}
              data-testid={`lobby-seat-${s}`}
            >
              <span className={styles.seatNum}>S{s + 1}</span>
              <span className={styles.seatName}>
                {nicknames[s] ?? (connectedPlayers > s ? "..." : "Vago")}
              </span>
              {s === seat && <span className={styles.you}>(você)</span>}
            </div>
          ))}
        </div>

        {connectedPlayers < 4 && (
          <p className={styles.hint}>
            {isOwner
              ? "Aguardando jogadores... Use o botão abaixo para preencher."
              : "Aguardando mais jogadores..."}
          </p>
        )}

        {connectedPlayers >= 4 && (
          <p className={styles.hint}>Partida iniciando!</p>
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
