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
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void boot();
  }, [boot]);

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
