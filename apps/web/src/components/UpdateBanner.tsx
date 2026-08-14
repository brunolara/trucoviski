import { useRegisterSW } from "virtual:pwa-register/react";

// ponytail: o browser só procura service worker novo em navegação, e um tab de
// jogo fica aberto por horas — daí o check periódico.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), CHECK_INTERVAL_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(1rem + env(safe-area-inset-bottom))",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        background: "#1a4d2e",
        color: "#e8dcc8",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        zIndex: 9998,
      }}
      data-testid="update-banner"
    >
      <span>Nova versão disponível</span>
      <button
        onClick={() => void updateServiceWorker(true)}
        style={{
          padding: "0.4rem 0.8rem",
          borderRadius: "0.375rem",
          background: "#7be89a",
          color: "#0d1b0f",
          fontWeight: "bold",
        }}
      >
        Atualizar
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{
          padding: "0.4rem 0.8rem",
          borderRadius: "0.375rem",
          background: "transparent",
          color: "#e8dcc8",
        }}
      >
        Depois
      </button>
    </div>
  );
}
