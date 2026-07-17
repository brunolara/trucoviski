import { useStore } from "../store.js";
import styles from "./Home.module.css";

export function Home() {
  const nickname = useStore((s) => s.nickname);
  const connecting = useStore((s) => s.connecting);
  const error = useStore((s) => s.error);
  const screen = useStore((s) => s.screen);
  const setNickname = useStore((s) => s.setNickname);
  const setRoomId = useStore((s) => s.setRoomId);
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const roomId = useStore((s) => s.roomId);

  if (screen !== "home") return null;

  return (
    <div className={styles.screen} data-testid="home-screen">
      <div className={styles.card}>
        <h1 className={styles.title}>Truco Paulista</h1>
        <p className={styles.subtitle}>Jogue online com amigos</p>

        <label className={styles.label}>
          Seu nickname
          <input
            className={styles.input}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Digite seu nome..."
            maxLength={16}
            autoFocus
            data-testid="nickname-input"
          />
        </label>

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            disabled={connecting || !nickname}
            onClick={() => void createRoom()}
            data-testid="create-room-btn"
          >
            {connecting ? "Conectando..." : "Criar Sala"}
          </button>

          <div className={styles.divider}>
            <span>ou entre em uma sala</span>
          </div>

          <input
            className={styles.input}
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Código da sala..."
            maxLength={32}
            data-testid="room-id-input"
          />

          <button
            className={styles.secondaryBtn}
            disabled={connecting || !nickname || !roomId}
            onClick={() => void joinRoom()}
            data-testid="join-room-btn"
          >
            Entrar
          </button>
        </div>

        {error && (
          <p className={styles.error} data-testid="error-message">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
