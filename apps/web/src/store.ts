/* ------------------------------------------------------------------ */
/*  Zustand store – mirrors Colyseus snapshots, drives screen flow    */
/* ------------------------------------------------------------------ */

import { create } from "zustand";
import { Client, type Room } from "@colyseus/sdk";
import type {
  SnapshotMessage,
  Action,
  PlayerView,
  GameEvent,
  MatchMetadata,
  Card,
  Seat,
  LogEntry,
} from "@trucoviski/shared";
import { NICKNAME_MAX_LENGTH } from "@trucoviski/shared";
import { sounds } from "./utils/sounds.js";

// ---- Session persistence (F: sobreviver ao F5) -----------------------

const SESSION_KEY = "trucoviski.session";
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:2568`
    : window.location.origin);

interface SavedSession {
  reconnectionToken: string;
  roomId: string;
  nickname: string;
}

function getReconnectionToken(room: Room): string | undefined {
  return (room as unknown as { reconnectionToken?: string }).reconnectionToken;
}

function saveSession(session: SavedSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore (private browsing / storage disabled)
  }
}

function readSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

function setRoomUrl(roomId: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sala", roomId);
    window.history.replaceState(null, "", url.pathname + url.search);
  } catch {
    // ignore
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("sala")) {
      url.searchParams.delete("sala");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  } catch {
    // ignore
  }
}

function persistSession(room: Room, nickname: string): void {
  const token = getReconnectionToken(room);
  if (token) {
    saveSession({ reconnectionToken: token, roomId: room.roomId, nickname });
  }
  setRoomUrl(room.roomId);
}

// ---- Types ----------------------------------------------------------

export type Screen = "home" | "lobby" | "mesa" | "end";

export interface StoreState {
  // Connection
  client: Client | null;
  room: Room | null;
  connecting: boolean;
  reconnecting: boolean;
  error: string | null;

  // Screen flow
  screen: Screen;
  nickname: string;
  roomId: string;

  // Snapshot mirror
  seat: number;
  status: "waiting" | "playing" | "finished";
  connectedPlayers: number;
  metadata: {
    rulesetName: string;
    rulesetVersion: string;
    prngVersion: string;
  };
  view: PlayerView | null;
  events: GameEvent[];
  /** Histórico da partida (console). */
  log: LogEntry[];
  replayMetadata: MatchMetadata | null;
  nicknames: Record<number, string>;
  /** Assentos ocupados por bots (lobby). */
  botSeats: number[];
  roomOwnerSessionId: string;
  isOwner: boolean;

  // Social state (F4)
  chatMessages: Record<number, { text: string; timestamp: number }>;
  emotes: Record<number, { emoji: string; timestamp: number }>;
  activeTomato: {
    senderSeat: number;
    targetSeat: number;
    phase: "flying" | "splat";
    timestamp: number;
  } | null;

  // Presentation banner (F: pacing)
  banner: { text: string; team?: 0 | 1 } | null;
  /** Congela as cartas da vaza durante reveal → vaza → sweep. */
  tableHold: {
    plays: readonly (Card | null)[];
    covered: readonly boolean[];
    winner?: Seat | null;
    sweeping?: boolean;
  } | null;

  // Actions
  setNickname: (name: string) => void;
  setRoomId: (id: string) => void;
  setConnecting: (v: boolean) => void;
  setReconnecting: (v: boolean) => void;
  setError: (msg: string | null) => void;
  createRoom: () => Promise<void>;
  createBotGame: () => Promise<void>;
  joinRoom: () => Promise<void>;
  boot: () => Promise<void>;
  fillBots: () => void;
  startGame: () => void;
  swapSeats: (a: number, b: number) => void;
  dispatchAction: (action: Action) => void;
  handleSnapshot: (snap: SnapshotMessage) => void;
  skipPresentation: () => void;
  goToHome: () => void;
  reset: () => void;

  // Social actions (F4)
  sendChat: (text: string) => void;
  sendEmote: (emoji: string) => void;
  throwTomato: (targetSeat: number) => void;
}

// ---- Initial state --------------------------------------------------

const initialMeta = {
  rulesetName: "paulista",
  rulesetVersion: "1.0.0",
  prngVersion: "mulberry32/1.0.0",
};

const initialState = {
  client: null,
  room: null,
  connecting: false,
  reconnecting: false,
  error: null,
  screen: "home" as Screen,
  nickname: "",
  roomId: "",
  seat: -1,
  status: "waiting" as const,
  connectedPlayers: 0,
  metadata: { ...initialMeta },
  view: null,
  events: [],
  log: [] as LogEntry[],
  replayMetadata: null,
  nicknames: {} as Record<number, string>,
  botSeats: [] as number[],
  roomOwnerSessionId: "",
  isOwner: false,

  // Social
  chatMessages: {},
  emotes: {},
  activeTomato: null,
  banner: null,
  tableHold: null,
};

// ---- Snapshot presentation queue (F: pacing) -------------------------
// ponytail: closure-scoped, not zustand state — it doesn't drive UI directly.

const HOLD_MS: Partial<Record<GameEvent["type"], number>> = {
  cardPlayed: 600,
  trucoRaised: 1500,
  trucoAccepted: 1500,
  trucoRan: 1500,
  surrendered: 1500,
  handFinished: 2000,
};

/** Beats de apresentação da vaza (cliente). */
const REVEAL_MS = 600;
const VAZA_MS = 1600;
const SWEEP_MS = 300;
const HAND_MS = 2200;

const BANNER_PRIORITY: Partial<Record<GameEvent["type"], number>> = {
  trucoRaised: 1,
  trucoAccepted: 1,
  vazaCompleted: 2,
  trucoRan: 3,
  surrendered: 3,
  handFinished: 4,
};

/** Rótulo do valor de truco pedido (Paulista: 3=Truco, 6=Seis, 9=Nove, 12=Doze). */
const TRUCO_VALUE_NAME: Record<number, string> = {
  3: "TRUCO",
  6: "SEIS",
  9: "NOVE",
  12: "DOZE",
};

function seatTeam(seat: number): 0 | 1 {
  return seat === 0 || seat === 2 ? 0 : 1;
}

let skipHold: (() => void) | null = null;

function hold(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      skipHold = null;
      resolve();
    };
    const t = setTimeout(done, ms);
    skipHold = done;
  });
}

function holdForEvents(events: GameEvent[] | undefined): number {
  if (!events || events.length === 0) return 0;
  let ms = 0;
  for (const e of events) {
    ms = Math.max(ms, HOLD_MS[e.type] ?? 0);
  }
  return ms;
}

function bannerForEvents(
  events: GameEvent[] | undefined,
  nicknames: Record<number, string>,
): { text: string; team?: 0 | 1 } | null {
  if (!events || events.length === 0) return null;

  let best: GameEvent | null = null;
  let bestPriority = 0;
  for (const e of events) {
    const p = BANNER_PRIORITY[e.type] ?? 0;
    if (p > bestPriority) {
      bestPriority = p;
      best = e;
    }
  }
  if (!best) return null;

  const name = (seat: number) => nicknames[seat] ?? `Jogador ${seat + 1}`;

  switch (best.type) {
    case "vazaCompleted":
      return best.winner !== null
        ? {
            text: `${name(best.winner)} venceu a vaza!`,
            team: seatTeam(best.winner),
          }
        : { text: "Vaza empatada (canga)" };
    case "trucoRaised":
      return {
        text: `${name(best.seat)} pediu ${TRUCO_VALUE_NAME[best.pendingValue] ?? best.pendingValue}! Valendo ${best.pendingValue}`,
        team: seatTeam(best.seat),
      };
    case "trucoAccepted":
      return { text: `Truco aceito! Valendo ${best.value}` };
    case "trucoRan":
      return {
        text: `${name(best.seat)} correu! +${best.tentos} tento(s)`,
        team: best.winnerTeam,
      };
    case "surrendered":
      return {
        text: `${name(best.seat)} desistiu! +${best.tentos} tento(s)`,
        team: best.winnerTeam,
      };
    case "handFinished":
      return {
        text: `+${best.tentos} tento(s) para o time ${best.winnerTeam === 0 ? "azul" : "vermelho"}`,
        team: best.winnerTeam,
      };
    default:
      return null;
  }
}

// ---- Store ----------------------------------------------------------

export const useStore = create<StoreState>()((set, get) => {
  const snapshotQueue: SnapshotMessage[] = [];
  let processingQueue = false;
  // Sessão local (setada de forma síncrona ao conectar, antes de qualquer
  // snapshot enfileirado ser processado — evita a corrida com get().room).
  let mySessionId: string | null = null;

  function applySnapshot(snap: SnapshotMessage): void {
    const prevView = get().view;

    // Check if new hand or new vaza completed
    const prevCompletedVazas = prevView?.completedVazas.length ?? 0;
    const newCompletedVazas = snap.view?.completedVazas.length ?? 0;

    const prevPlays =
      prevView?.currentVaza?.plays.filter((p) => p !== null).length ?? 0;
    const newPlays =
      snap.view?.currentVaza?.plays.filter((p) => p !== null).length ?? 0;

    // Trigger sounds
    if (snap.status === "playing" && prevView === null) {
      sounds.playDeal();
    } else if (snap.status === "playing" && snap.view) {
      if (newCompletedVazas > prevCompletedVazas) {
        sounds.playPlay();
      } else if (newPlays > prevPlays) {
        sounds.playPlay();
      } else if (
        snap.view.handCards.length === 3 &&
        (prevView?.handCards.length ?? 0) < 3
      ) {
        sounds.playDeal();
      }
    }

    const nicknames = snap.nicknames ?? get().nicknames;

    set({
      seat: snap.seat,
      status: snap.status,
      connectedPlayers: snap.connectedPlayers,
      metadata: snap.metadata,
      view: snap.view ?? null,
      events: snap.events ?? [],
      // Mantém o que já tem se o snapshot não trouxer log.
      log: snap.log ?? get().log,
      replayMetadata: snap.replayMetadata ?? null,
      nicknames,
      botSeats: snap.botSeats ?? get().botSeats,
      roomOwnerSessionId: snap.ownerSessionId,
      isOwner: mySessionId === snap.ownerSessionId,
      banner: bannerForEvents(snap.events, nicknames),
    });

    // `screen: "end"` é adiado para depois dos holds em drainQueue —
    // senão a mesa some no mesmo frame do banner final.
    if (snap.status === "playing") {
      set({ screen: "mesa" });
    }
  }

  async function drainQueue(): Promise<void> {
    if (processingQueue) return;
    processingQueue = true;
    let snap: SnapshotMessage | undefined;
    while ((snap = snapshotQueue.shift())) {
      applySnapshot(snap);

      const vazaEvent = snap.events?.find((e) => e.type === "vazaCompleted");
      const handEvent = snap.events?.find((e) => e.type === "handFinished");
      const nicknames = get().nicknames;

      if (vazaEvent && vazaEvent.type === "vazaCompleted") {
        const { plays, covered, winner } = vazaEvent;
        // reveal: 4 cartas sem destaque
        set({ tableHold: { plays, covered }, banner: null });
        await hold(REVEAL_MS);
        // vaza: destaca vencedor + banner
        set({
          tableHold: { plays, covered, winner },
          banner: bannerForEvents([vazaEvent], nicknames),
        });
        await hold(VAZA_MS);
        // sweep: cartas deslizam para o vencedor
        set({
          tableHold: { plays, covered, winner, sweeping: true },
        });
        await hold(SWEEP_MS);
        if (handEvent && handEvent.type === "handFinished") {
          set({
            tableHold: null,
            banner: bannerForEvents([handEvent], nicknames),
          });
          await hold(HAND_MS);
        }
        set({ tableHold: null, banner: null });
      } else {
        const holdMs = holdForEvents(snap.events);
        if (holdMs > 0) {
          await hold(holdMs);
          set({ banner: null });
        }
      }

      if (snap.status === "finished") {
        set({ screen: "end", tableHold: null, banner: null });
        clearSession();
      }
    }
    processingQueue = false;
  }

  /**
   * Handlers de mensagem compartilhados entre createRoom e joinRoom (F4).
   */
  function registerRoomHandlers(room: Room): void {
    mySessionId = room.sessionId;

    room.onMessage("snapshot", (snap: SnapshotMessage) => {
      get().handleSnapshot(snap);
    });

    room.onMessage("actionRejected", (msg: { error: string }) => {
      console.warn("Ação rejeitada:", msg.error);
    });

    // Handlers Sociais (F4)
    room.onMessage("chatMessage", (msg: { seat: number; text: string }) => {
      set((state) => ({
        chatMessages: {
          ...state.chatMessages,
          [msg.seat]: { text: msg.text, timestamp: Date.now() },
        },
      }));
      setTimeout(() => {
        set((state) => {
          const current = state.chatMessages[msg.seat];
          if (current && Date.now() - current.timestamp >= 5000) {
            const next = { ...state.chatMessages };
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete next[msg.seat];
            return { chatMessages: next };
          }
          return {};
        });
      }, 5000);
    });

    room.onMessage("emote", (msg: { seat: number; emoji: string }) => {
      set((state) => ({
        emotes: {
          ...state.emotes,
          [msg.seat]: { emoji: msg.emoji, timestamp: Date.now() },
        },
      }));
      setTimeout(() => {
        set((state) => {
          const current = state.emotes[msg.seat];
          if (current && Date.now() - current.timestamp >= 5000) {
            const next = { ...state.emotes };
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete next[msg.seat];
            return { emotes: next };
          }
          return {};
        });
      }, 5000);
    });

    room.onMessage(
      "tomatoThrown",
      (msg: { senderSeat: number; targetSeat: number }) => {
        sounds.playTomatoThrow();
        set({
          activeTomato: {
            senderSeat: msg.senderSeat,
            targetSeat: msg.targetSeat,
            phase: "flying",
            timestamp: Date.now(),
          },
        });
        setTimeout(() => {
          sounds.playTomatoSplat();
          set((state) => {
            if (
              state.activeTomato &&
              state.activeTomato.senderSeat === msg.senderSeat &&
              state.activeTomato.targetSeat === msg.targetSeat
            ) {
              return {
                activeTomato: {
                  ...state.activeTomato,
                  phase: "splat",
                },
              };
            }
            return {};
          });
          setTimeout(() => {
            set((state) => {
              if (
                state.activeTomato &&
                state.activeTomato.senderSeat === msg.senderSeat &&
                state.activeTomato.targetSeat === msg.targetSeat
              ) {
                return { activeTomato: null };
              }
              return {};
            });
          }, 1000);
        }, 500);
      },
    );

    // Handler de desconexão involuntária (fail-closed, erro de rede).
    room.onLeave(async (code: number) => {
      if (code === 1000) return; // leave voluntário

      set({ reconnecting: true });

      const attemptReconnect = async (attemptsLeft: number) => {
        try {
          const client = get().client;
          if (!client) throw new Error("No client to reconnect");

          // Use reconnectionToken if available (Colyseus 0.14+)
          const token = getReconnectionToken(room);
          const newRoom = token
            ? await client.reconnect(token)
            : await client.reconnect(room.roomId, room.sessionId);

          set({ room: newRoom, reconnecting: false });
          registerRoomHandlers(newRoom);
          persistSession(newRoom, get().nickname);
        } catch {
          if (attemptsLeft > 0) {
            setTimeout(() => attemptReconnect(attemptsLeft - 1), 2000);
          } else {
            set({
              error: "Conexão perdida com a sala após várias tentativas.",
              connecting: false,
              reconnecting: false,
              screen: "home",
              room: null,
              client: null,
            });
          }
        }
      };

      attemptReconnect(5);
    });

    // Handler de erro de transporte.
    room.onError((code: number, message?: string) => {
      void code;
      void message;
      set({
        error: "Erro de comunicação com o servidor.",
        connecting: false,
      });
    });
  }

  return {
    ...initialState,

    setNickname(name) {
      set({ nickname: name.slice(0, NICKNAME_MAX_LENGTH).trim() });
    },

    setRoomId(id) {
      set({ roomId: id.trim() });
    },

    setConnecting(v) {
      set({ connecting: v });
    },

    setReconnecting(v) {
      set({ reconnecting: v });
    },

    setError(msg) {
      set({ error: msg, connecting: false });
    },

    async createRoom() {
      const { nickname } = get();
      if (!nickname) {
        set({ error: "Escolha um nickname primeiro." });
        return;
      }
      set({ connecting: true, error: null });

      try {
        const client = new Client(SERVER_URL);
        const room = await client.create("truco", { nickname });

        // Registra handlers ANTES de atualizar o estado para não perder mensagens iniciais
        registerRoomHandlers(room);

        // Recupera snapshot inicial que pode ter sido emitido durante o await.
        room.send("sync", {});
        persistSession(room, nickname);

        set({
          client,
          room,
          screen: "lobby",
          connecting: false,
        });
      } catch (err) {
        set({
          error: "Erro ao criar sala: " + String(err),
          connecting: false,
        });
      }
    },

    async createBotGame() {
      await get().createRoom();
      if (get().room) {
        get().fillBots();
        get().startGame();
      }
    },

    async joinRoom() {
      const { nickname, roomId } = get();
      if (!nickname || !roomId) {
        set({ error: "Preencha nickname e código da sala." });
        return;
      }
      set({ connecting: true, error: null });

      try {
        const client = new Client(SERVER_URL);
        const room = await client.joinById(roomId, { nickname });

        // Registra handlers ANTES de atualizar o estado para não perder mensagens iniciais
        registerRoomHandlers(room);

        // Recupera snapshot inicial que pode ter sido emitido durante o await.
        room.send("sync", {});
        persistSession(room, nickname);

        set({
          client,
          room,
          screen: "lobby",
          connecting: false,
        });
      } catch (err) {
        set({
          error: "Erro ao entrar na sala: " + String(err),
          connecting: false,
        });
      }
    },

    fillBots() {
      const { room } = get();
      if (!room) return;
      room.send("fillBots", {});
    },

    startGame() {
      const { room } = get();
      if (!room) return;
      room.send("startGame", {});
    },

    swapSeats(a, b) {
      const { room } = get();
      if (!room) return;
      room.send("swapSeats", { a, b });
    },

    dispatchAction(action) {
      const { room } = get();
      if (!room) return;
      room.send("action", { payload: action });
    },

    sendChat(text) {
      const { room } = get();
      if (!room) return;
      room.send("chat", { text });
    },

    sendEmote(emoji) {
      const { room } = get();
      if (!room) return;
      room.send("emote", { emoji });
    },

    throwTomato(targetSeat) {
      const { room } = get();
      if (!room) return;
      room.send("throwTomato", { targetSeat });
    },

    handleSnapshot(snap: SnapshotMessage) {
      snapshotQueue.push(snap);
      void drainQueue();
    },

    skipPresentation() {
      skipHold?.();
    },

    goToHome() {
      skipHold?.();
      skipHold = null;
      const { room } = get();
      if (room) {
        // Remove handlers antes do leave voluntário para não disparar onLeave.
        (room.onLeave as { clear(): void }).clear();
        (room.onError as { clear(): void }).clear();
        try {
          room.leave();
        } catch {
          // ignore
        }
      }
      snapshotQueue.length = 0;
      processingQueue = false;
      mySessionId = null;
      clearSession();
      set({ ...initialState, screen: "home" });
    },

    reset() {
      skipHold?.();
      skipHold = null;
      const { room } = get();
      if (room) {
        (room.onLeave as { clear(): void }).clear();
        (room.onError as { clear(): void }).clear();
        try {
          room.leave();
        } catch {
          // ignore
        }
      }
      snapshotQueue.length = 0;
      processingQueue = false;
      mySessionId = null;
      clearSession();
      set({ ...initialState });
    },

    async boot() {
      const session = readSession();
      const url = new URL(window.location.href);
      const urlRoomId = url.searchParams.get("sala");

      if (session) {
        try {
          const client = new Client(SERVER_URL);
          const room = await client.reconnect(session.reconnectionToken);
          registerRoomHandlers(room);
          room.send("sync", {});
          persistSession(room, session.nickname);
          set({
            client,
            room,
            nickname: session.nickname,
            roomId: session.roomId,
            screen: "lobby",
          });
          return;
        } catch {
          // token expirado ou sala fechada — tenta rejoin por roomId abaixo.
        }

        try {
          const client = new Client(SERVER_URL);
          const room = await client.joinById(session.roomId, {
            nickname: session.nickname,
          });
          registerRoomHandlers(room);
          room.send("sync", {});
          persistSession(room, session.nickname);
          set({
            client,
            room,
            nickname: session.nickname,
            roomId: session.roomId,
            screen: "lobby",
          });
          return;
        } catch {
          // sala não existe mais — cai para a Home abaixo.
        }
      }

      clearSession();
      if (urlRoomId) {
        set({ roomId: urlRoomId });
      }
    },
  };
});
