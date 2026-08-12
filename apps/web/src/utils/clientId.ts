const KEY = "trucoviski.clientId";

/** Identidade do navegador. localStorage: sobrevive a F5, aba fechada e reboot. */
export function getClientId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const id = newId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // aba anônima / storage bloqueado: identidade dura só esta sessão.
    return newId();
  }
}

// crypto.randomUUID exige contexto seguro (https ou localhost).
function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
