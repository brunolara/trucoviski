import { useStore } from "../store.js";
import styles from "./End.module.css";

export function End() {
  const screen = useStore((s) => s.screen);
  const seat = useStore((s) => s.seat);
  const view = useStore((s) => s.view);
  const replayMetadata = useStore((s) => s.replayMetadata);
  const goToHome = useStore((s) => s.goToHome);

  if (screen !== "end") return null;

  const myTeam = seat === 0 || seat === 2 ? 0 : 1;
  const scores = view?.scores ?? [0, 0];
  const opponentTeam = myTeam === 0 ? 1 : 0;
  const iWon = (scores[myTeam] ?? 0) >= 12;
  const winnerTeam = (scores[0] ?? 0) >= 12 ? 0 : 1;

  return (
    <div className={styles.screen} data-testid="end-screen">
      <div className={styles.card}>
        <h1 className={styles.heading} data-testid="end-heading">
          Fim de Partida
        </h1>

        <div className={styles.result}>
          <span
            className={iWon ? styles.win : styles.loss}
            data-testid="end-result"
          >
            {iWon ? "Vitória!" : "Derrota"}
          </span>
        </div>

        <div className={styles.scores}>
          <p data-testid="end-score-my-team">
            Seu time (Nós): <strong>{scores[myTeam]}</strong> tentos
          </p>
          <p data-testid="end-score-opp-team">
            Oponentes (Eles): <strong>{scores[opponentTeam]}</strong> tentos
          </p>
        </div>

        <div className={styles.winner} data-testid="end-winner">
          Time vencedor:{" "}
          <strong>{winnerTeam === myTeam ? "Nós" : "Eles"}</strong>
        </div>

        {replayMetadata && (
          <div className={styles.replay} data-testid="end-replay-metadata">
            <p data-testid="end-replay-seed">Seed: {replayMetadata.seed}</p>
            <p data-testid="end-replay-ruleset">
              Ruleset: {replayMetadata.rulesetName} v
              {replayMetadata.rulesetVersion}
            </p>
          </div>
        )}

        <button
          className={styles.homeBtn}
          onClick={goToHome}
          data-testid="end-home-btn"
        >
          Voltar ao Início
        </button>
      </div>
    </div>
  );
}
