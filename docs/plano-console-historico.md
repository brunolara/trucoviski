# Plano — Console de histórico da partida (estilo PokerStars)

Status: proposta. Fatia nova, fora de F1–F6. Requer autorização explícita do
humano antes de implementar.

## Contexto

Hoje o jogador não tem como saber o que já aconteceu. Tudo é transitório: o
`banner` de apresentação vive 1,6s (`apps/web/src/store.ts:264` escolhe **um**
evento por snapshot e descarta o resto), o balão de chat vive 5s e é sobrescrito
pelo próximo (`store.ts:407`, um slot por assento), `store.ts:363` faz
`events: snap.events ?? []` — **substitui**, não acumula — e a faixa de vazas já
escrita em `Mesa.tsx:644` está `display: none` (`Mesa.module.css:415`) e só
cobre a mão corrente. O servidor não guarda nada: `logger.ts` só registra erros
e rate-limit, e nenhum evento de jogo é persistido em lugar algum.

Objetivo: um botão na mesa abre um modal rolável com a partida inteira em ordem
cronológica — cartas jogadas, pedidos/aceites/corridas de truco, quem venceu
cada vaza **e com qual carta** ("Zé venceu a vaza com 4 de paus (manilha)"),
resultado de cada mão com placar, chat, emojis e tomates.

Decisões do humano nesta fatia: histórico **acumulado no servidor** (sobrevive a
F5/reconexão e é idêntico para todos), inclui **chat + emojis/tomate**, e abre
por **botão próprio na mesa**.

O trabalho é pequeno porque o vocabulário já existe: `GameEvent`
(`packages/engine/src/types.ts:93-168`) já descreve tudo o que precisa ser
logado, e `broadcastSnapshots(events)` (`room.ts:703`) é o funil único por onde
esses eventos passam. Nada muda em `packages/engine`.

## Etapa 1 — `packages/shared/src/index.ts`: o tipo da linha

Uma união discriminada. O servidor guarda **dados**, não frases — a prosa
continua no cliente, onde as tabelas de tradução já vivem.

```ts
/** Uma entrada do histórico da partida. Ordem do array = ordem cronológica. */
export type LogEntry =
  | { kind: "event"; t: number; event: GameEvent }
  | { kind: "chat"; t: number; seat: number; text: string }
  | { kind: "emote"; t: number; seat: number; emoji: string }
  | { kind: "tomato"; t: number; senderSeat: number; targetSeat: number };
```

E um campo em `SnapshotMessage` (`shared/src/index.ts:67-87`), ao lado de
`events`:

```ts
  /** Histórico completo da partida (console). */
  log?: LogEntry[];
```

`GameEvent` já está importado no arquivo (`shared/src/index.ts:9`).

## Etapa 2 — `apps/server/src/room.ts`: acumular

Campo novo, ao lado de `lastAdviceKey` (`room.ts:158`):

```ts
  /** Histórico da partida (console do cliente). */
  private log: LogEntry[] = [];
```

**2.1 — Mão 1 é sintética.** `createMatch` chama `startNextHand` sem emitir
evento (`packages/engine/src/match.ts:74`); só as auto-transições em `dispatch`
empurram `handStarted` (`match.ts:125-130`). Sem isso o histórico não tem a vira
da primeira mão — e a vira é o que decide se a carta vencedora era manilha. Em
`onCreate`, logo após `createMatch` (`room.ts:164`), o estado da mão 1 já
existe:

```ts
const st = this.match.state();
if (st.hand) {
  this.log.push({
    kind: "event",
    t: Date.now(),
    // ponytail: a engine não emite handStarted da mão 1 (match.ts:74).
    event: {
      type: "handStarted",
      handNumber: st.handNumber,
      dealerSeat: st.dealerSeat,
      vira: st.hand.vira,
    },
  });
}
```

**2.2 — Um único ponto de entrada para eventos de jogo.** No topo de
`broadcastSnapshots` (`room.ts:703`). As chamadas `broadcastSnapshots([])`
(nickname, join, lobby, sync) viram no-op naturalmente:

```ts
  private broadcastSnapshots(events: readonly GameEvent[]): void {
    const t = Date.now();
    for (const e of events) this.log.push({ kind: "event", t, event: e });
    // ponytail: partida de 12 tentos não passa de ~400 linhas; corta as antigas.
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    }
    this.maybeAdvise();          // ← movido para ANTES do envio (ver 2.3)
    for (const c of this.clients) { /* inalterado */ }
  }
```

com `const MAX_LOG_ENTRIES = 600;` junto das outras constantes do topo.

**2.3 — Conselho do bot.** `maybeAdvise` (`room.ts:718`) hoje roda **depois**
dos snapshots; movida para antes, o conselho entra no mesmo snapshot em vez de
só aparecer no próximo. É seguro: `maybeAdvise` só lê `playerView`, que enviar
snapshot não altera. Na linha do broadcast (`room.ts:742`):

```ts
if (text) {
  this.pushSocial({ kind: "chat", t: Date.now(), seat: botSeat, text });
}
```

**2.4 — Social.** Um helper, porque chat/emote/tomate precisam empurrar a linha
**e** avisar todo mundo na hora (senão a linha só chega no próximo snapshot):

```ts
  /** Registra no histórico e reenvia snapshots (o log vai neles). */
  private pushSocial(entry: LogEntry): void {
    this.log.push(entry);
    if (entry.kind === "chat")
      this.broadcast("chatMessage", { seat: entry.seat, text: entry.text });
    else if (entry.kind === "emote")
      this.broadcast("emote", { seat: entry.seat, emoji: entry.emoji });
    else if (entry.kind === "tomato")
      this.broadcast("tomatoThrown", {
        senderSeat: entry.senderSeat,
        targetSeat: entry.targetSeat,
      });
    this.broadcastSnapshots([]);
  }
```

Cuidado com recursão: `maybeAdvise` (chamada dentro de `broadcastSnapshots`) usa
`pushSocial`, que chama `broadcastSnapshots` de novo. O dedupe `lastAdviceKey`
(`room.ts:738`) corta na segunda passada — já é setado antes do broadcast. Vale
um comentário no `pushSocial` apontando isso.

Os três handlers existentes (`handleChat` `room.ts:435`, `handleEmote`
`room.ts:454`, `handleThrowTomato` `room.ts:473`) trocam o `this.broadcast(...)`
por uma chamada a `pushSocial`. Os rate limits (2s / 1,5s / 3s) ficam como estão
e já limitam o tráfego desse caminho.

**2.5 — Enviar.** Em `sendSnapshot` (`room.ts:758`), junto de `nicknames`:

```ts
      // ponytail: manda o log inteiro em cada snapshot (~30KB no fim de uma
      // partida longa). Se o tráfego incomodar, mandar só a cauda com índice.
      log: [...this.log],
```

Não há reset: `createMatch` só acontece em `onCreate` (`room.ts:164`), uma sala
= uma partida.

Sem vazamento novo: `cardPlayed` já é broadcastado a todos hoje via
`snapshot.events`; carta coberta é `card: null` na engine (`match.ts:378`) e
nunca é revelada. No ferro o log mostra o que está na mesa, que a mesa já
mostra.

## Etapa 3 — `apps/web/src/utils/historico.ts` (novo): a prosa

Puro, sem React, sem store — testável em vitest. Reusa `isManilha` da engine (já
exportado em `packages/engine/src/index.ts:58`, hoje reimplementado à mão em
`Mesa.tsx:21-28`).

```ts
export interface LogLine {
  hand: number; // mão a que a linha pertence (divisor no modal)
  time: string; // "20:14:02"
  text: string;
  team?: 0 | 1; // colore a linha com --team-blue / --team-red
}

export function cardLabel(card: Card, vira: Card | null): string; // "4 de paus (manilha)"
export function logLines(
  log: LogEntry[],
  nicknames: Record<number, string>,
): LogLine[];
```

`logLines` varre o array uma vez mantendo três acumuladores — `hand` e `vira`
(atualizados em cada `handStarted`) e `scores` (somados em cada `handFinished`,
o único evento autoritativo de pontuação:
`reason: "vazas" | "run" | "surrender"`, `types.ts:157`). Frases, reusando o
vocabulário que já está em `store.ts:283-315` (`TRUCO_VALUE_NAME`, `seatTeam`) e
`Mesa.tsx:12` (`RANK_NAMES`):

| evento                           | linha                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| `handStarted`                    | divisor `Mão 3 — vira: 5 de copas — embaralhou: Ana`          |
| `cardPlayed` (`covered: false`)  | `Bruno jogou K de copas`                                      |
| `cardPlayed` (`covered: true`)   | `Bruno jogou carta coberta`                                   |
| `vazaCompleted` (`winner`)       | `Vaza 1: Zé venceu com 4 de paus (manilha)` ← `plays[winner]` |
| `vazaCompleted` (`winner: null`) | `Vaza 1: canga (empate)`                                      |
| `trucoRaised`                    | `Ana pediu TRUCO! Valendo 3`                                  |
| `trucoAccepted`                  | `Truco aceito — valendo 3`                                    |
| `trucoRan`                       | `Bruno correu! Time vermelho +1 tento`                        |
| `surrendered`                    | `Bruno desistiu! Time vermelho +3 tentos`                     |
| `elevenDecided`                  | `Mão de onze: decidiram jogar` / `correr`                     |
| `handFinished`                   | `Mão 3: time azul +3 tentos (por vazas) — placar 6×3`         |
| `matchFinished`                  | `Fim de partida: time azul venceu 12×7`                       |
| `chat`                           | `💬 Bruno: truco neles!`                                      |
| `emote`                          | `😂 Ana`                                                      |
| `tomato`                         | `🍅 Bruno acertou um tomate em Zé`                            |

Limitações herdadas da engine, aceitas nesta fatia: `trucoAccepted` não carrega
seat e `elevenDecided` não carrega seat/team (`types.ts:133,145`), então essas
duas linhas saem sem nome. Corrigir exige campo novo na engine — fora de escopo.

Enquanto o arquivo existe, `Mesa.tsx` passa a importar dele `seatName` (hoje
`Mesa.tsx:34`) e a checagem de manilha (hoje `Mesa.tsx:21-28`), apagando as
duplicatas locais. Diff líquido negativo em `Mesa.tsx`.

## Etapa 4 — `apps/web/src/store.ts`: espelhar

Um campo em `StoreState` (junto de `events`, `store.ts:117`) e em `initialState`
(`store.ts:188`) — `reset()`/`goToHome()` já espalham `initialState`, então
limpar é grátis:

```ts
  log: LogEntry[];
```

E em `applySnapshot` (`store.ts:357`), dentro do `set` já existente:

```ts
      log: snap.log ?? get().log,   // mantém o que já tem se o snapshot não trouxer
```

Nada mais. Os handlers sociais (`store.ts:407/429/451`) continuam cuidando só
dos balões transitórios — o histórico deles vem do servidor.

## Etapa 5 — `apps/web/src/screens/Mesa.tsx` + `Mesa.module.css`: o modal

Clone do painel social (`Mesa.tsx:900-970`), que já resolveu acessibilidade e
layout: `role="dialog"`, `aria-modal`, Escape, `autoFocus` no fechar, e o
`onPointerDown={(e) => e.stopPropagation()}` **obrigatório** — sem ele o tap
atravessa e dispara `skipPresentation()` (`Mesa.tsx:242-248`).

- `const [showLog, setShowLog] = useState(false);` (ao lado de
  `showSocialPanel`, `Mesa.tsx:99`).
- Botão `📜 Histórico` junto do `social-toggle-btn` (`Mesa.tsx:866`),
  `data-testid="log-toggle-btn"`, `min-height: 32px` (o e2e exige ≥40px para os
  alvos que ele mede).
- Modal `data-testid="log-panel"`, fechar `data-testid="log-close-btn"`.
- Conteúdo: `logLines(log, nicknames)` mapeado; divisores de mão como `<h3>`;
  cada linha `<time>` + texto, colorida por `team` via `TEAM_COLORS`
  (`Mesa.tsx:41`).
- Rolagem interna (`.screen` é `overflow: hidden`, 430×932 escalado):
  `overflow-y: auto` + `ref` com `scrollTop = scrollHeight` num `useEffect` ao
  abrir, para cair no fim (mais recente à vista).
- CSS: reusar `.socialOverlay` / `.socialPanel` (`Mesa.module.css:631-661`) via
  `composes`, `max-height: 80%`; classes novas só `.logLine`, `.logHand`,
  `.logTime`. Fonte `VT323` no corpo, `Press Start 2P` 10px no
  cabeçalho/divisores, como no resto da mesa.

## Verificação

1. `pnpm gate` (format + lint + types + vitest + sim + build).
2. Testes novos:
   - `tests/historico.test.ts` — puro, sem mocks: vaza com manilha →
     `"venceu com 4 de paus (manilha)"`; carta coberta → `"carta coberta"`;
     canga; escada truco 3→6→9→12; `handFinished` acumulando o placar em duas
     mãos; chat/emote/tomate.
   - `tests/log-store.test.ts` (ou um `it` em
     `tests/presentation-store.test.ts`, que já tem os mocks de
     `@colyseus/sdk`/`sounds`/`window` prontos, `:12-52`) — dois
     `handleSnapshot` seguidos, o segundo com log maior →
     `useStore.getState().log` reflete o do servidor; snapshot sem `log` não
     apaga o anterior.
   - `tests/f4-server.test.ts` (mesmo padrão `@colyseus/testing`) — após uma
     ação, o snapshot traz `log` com `handStarted` da mão 1 + o `cardPlayed`;
     após `chat`, o snapshot traz a entrada `kind: "chat"`.
3. `tests/e2e/10-historico.spec.ts` — preâmbulo `joinMesa` (copiar de
   `tests/e2e/07-f7-pixel-art.spec.ts:29-42`): abrir `log-toggle-btn`, esperar
   `log-panel` visível, jogar uma carta com o painel fechado, reabrir e assertar
   que existe linha com `"jogou"`, fechar por `log-close-btn` e por Escape.
4. Manual, `pnpm dev` → "Jogar contra bots": jogar uma mão inteira, abrir o
   console e conferir vaza-a-vaza com a carta vencedora, o placar depois da mão
   e as falas do bot parceiro; dar **F5 no meio da partida** e reabrir o console
   — o histórico tem que voltar inteiro (é o motivo de acumular no servidor).

## Fora de escopo

Persistência em SQLite (D5 não implementado — o log morre com a sala); replay
navegável a partir da seed (`End.tsx:49` já expõe a seed); exportar/copiar o
histórico; console na tela `End`; revelar carta coberta no fim da mão (a engine
não guarda qual era, decisão F5); seat em `trucoAccepted`/`elevenDecided`.
