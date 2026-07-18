import { useEffect, useRef } from "react";
import { useStore } from "./store.js";
import { Home } from "./screens/Home.js";
import { Lobby } from "./screens/Lobby.js";
import { Mesa } from "./screens/Mesa.js";
import { End } from "./screens/End.js";

export function App() {
  const screen = useStore((s) => s.screen);
  const reconnecting = useStore((s) => s.reconnecting);
  const boot = useStore((s) => s.boot);
  const setReconnecting = useStore((s) => s.setReconnecting);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void boot();
  }, [boot]);

  useEffect(() => {
    const showReconnect = () => setReconnecting(true);
    const hideReconnect = () => setReconnecting(false);
    window.addEventListener("offline", showReconnect);
    window.addEventListener("online", hideReconnect);
    return () => {
      window.removeEventListener("offline", showReconnect);
      window.removeEventListener("online", hideReconnect);
    };
  }, [setReconnecting]);

  return (
    <>
      {reconnecting && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            fontSize: "1.5rem",
            fontWeight: "bold",
          }}
          data-testid="reconnecting-overlay"
        >
          Reconectando...
        </div>
      )}
      {(() => {
        switch (screen) {
          case "home":
            return <Home />;
          case "lobby":
            return <Lobby />;
          case "mesa":
            return <Mesa />;
          case "end":
            return <End />;
          default:
            return <Home />;
        }
      })()}
    </>
  );
}
