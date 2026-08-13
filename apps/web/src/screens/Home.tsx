import { useEffect, useState } from "react";
import { pickRandomPlayerName } from "@trucoviski/shared";
import { PlayerAvatar } from "../components/PlayerAvatar.js";
import { useStore } from "../store.js";
import styles from "./Home.module.css";

export function Home() {
  const nickname = useStore((s) => s.nickname);
  const connecting = useStore((s) => s.connecting);
  const error = useStore((s) => s.error);
  const screen = useStore((s) => s.screen);
  const setNickname = useStore((s) => s.setNickname);
  const setRoomId = useStore((s) => s.setRoomId);
  const createBotGame = useStore((s) => s.createBotGame);
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const roomId = useStore((s) => s.roomId);

  // O retrato vem da rede: sem o atraso, cada tecla dispara uma request.
  const [avatarSeed, setAvatarSeed] = useState(nickname);
  useEffect(() => {
    const id = setTimeout(() => setAvatarSeed(nickname), 400);
    return () => clearTimeout(id);
  }, [nickname]);

  if (screen !== "home") return null;

  const canAct = Boolean(nickname) && !connecting;

  function generateNickname() {
    const exclude = nickname ? new Set([nickname]) : new Set<string>();
    setNickname(pickRandomPlayerName(exclude));
  }

  return (
    <div className={styles.screen} data-testid="home-screen">
      <div className={styles.card}>
        <h1 className={styles.title}>Truco Paulista</h1>

        <div className={styles.avatarPreview}>
          <PlayerAvatar
            seed={avatarSeed}
            alt="Sua foto de perfil"
            size={96}
            className={styles.avatarImg}
          />
        </div>

        <label className={styles.label} htmlFor="nickname-input">
          Seu nome
        </label>
        <div className={styles.nameRow}>
          <input
            id="nickname-input"
            className={styles.input}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Digite seu nome..."
            maxLength={32}
            autoFocus
            data-testid="nickname-input"
          />
          <button
            type="button"
            className={styles.generateBtn}
            onClick={generateNickname}
            disabled={connecting}
            aria-label="Gerar nome aleatório"
            title="Gerar nome aleatório"
            data-testid="generate-name-btn"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
              <circle
                cx="16"
                cy="8"
                r="1.2"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="8"
                cy="16"
                r="1.2"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="16"
                cy="16"
                r="1.2"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="12"
                cy="12"
                r="1.2"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            disabled={!canAct}
            onClick={() => void createBotGame()}
            data-testid="play-bots-btn"
          >
            {connecting ? "Conectando..." : "Jogar contra bots"}
          </button>

          <div className={styles.divider} data-testid="versus-section">
            <span>Versus</span>
          </div>

          <button
            className={styles.secondaryBtn}
            disabled={!canAct}
            onClick={() => void createRoom()}
            data-testid="create-room-btn"
          >
            Criar sala
          </button>

          <input
            className={styles.input}
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Código da sala..."
            maxLength={32}
            aria-label="Código da sala"
            data-testid="room-id-input"
          />

          <button
            className={styles.secondaryBtn}
            disabled={!canAct || !roomId}
            onClick={() => void joinRoom()}
            data-testid="join-room-btn"
          >
            Entrar em sala
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
