# Plano — Sala persistente, identidade do navegador e código legível

Status: **implementado**. Slice de 4 bugs acoplados (server + web + shared).
Nada de engine. Executar na ordem das seções 1→7; cada seção é commitável
sozinha.

## Sumário do que muda

| #   | Problema hoje                                      | Alvo                                                      |
| --- | -------------------------------------------------- | --------------------------------------------------------- |
| 1   | Sala some quando o último humano sai               | Sala vive **5 min vazia** antes de ser descartada         |
| 2   | Dono é `sessionId` (morre no F5)                   | Dono é um **identificador do navegador** (`localStorage`) |
| 3   | Quem volta depois de 180 s perde o assento pro bot | Volta pelo identificador e **retoma o assento**           |
| 4   | Código da sala é `xKf9aQ2mZ`                       | Código é **`morango exemplar`** (estilo LocalSend)        |

---

## 0. Diagnóstico (raiz de cada bug)

**Bug 1 — a sala evapora.** Duas causas somadas:

- `Room.autoDispose` é `true` por padrão no Colyseus; quando `clients.length`
  chega a 0 a sala é descartada em ~1 s (`@colyseus/core/build/Room.mjs`,
  `resetAutoDisposeTimeout` / `#_disposeIfEmpty`).
- O `room.ts` ainda reforça isso à mão: três blocos fail-closed chamam
  `this.disconnect()` quando `occupied.size === 0` — `room.ts:279-289`,
  `room.ts:334-347` e `room.ts:374-390`.

**Bug 2 — o dono não sobrevive ao F5.** `ownerSessionId` guarda o `sessionId` do
Colyseus (`room.ts:163-164`, `room.ts:244-246`), que é novo a cada conexão. No
lobby (`status === "waiting"`) o `onLeave` nem chama `allowReconnection`
(`room.ts:258-273`), então um F5 gera um cliente novo, sem vínculo com o
anterior, e a posse é repassada para outro humano.

**Bug 3 — assento perdido.** Durante `playing` o assento vira bot
(`room.ts:290`) e só volta pelo `reconnectionToken` dentro de
`RECONNECT_SECONDS = 180` (`room.ts:301-330`). Passou disso, ou perdeu o token
(aba fechada — o token mora em `sessionStorage`, `store.ts:41`), o bot fica até
o fim. Pior: `startGame` chama `this.lock()` (`room.ts:461`), e sala travada
recusa `joinById` — não há nem como tentar voltar.

**Bug 4 — código ilegível.** O `roomId` é o id de 9 caracteres gerado pelo
matchmaker (`MatchMaker.mjs`, `handleCreateRoom`: `room.roomId = generateId()`).
O setter público de `roomId` **é permitido durante o `onCreate`** e o matchmaker
só registra a sala depois (`_listing.roomId = room.roomId` e
`createRoomReferences` rodam após o `await room.onCreate(...)`) — ou seja, dá
para trocar o id sem tocar em nada do Colyseus.

## 0.1 Decisões travadas (registrar em `docs/decisions.md`)

- **D-sala-1** — Sala vazia sobrevive **5 minutos** (`EMPTY_ROOM_TTL_MS`). Vazia
  = `occupied.size === 0` (bots não contam). O prazo é maior que
  `RECONNECT_SECONDS` (180 s) de propósito: a reconexão nunca deve ser podada
  pelo TTL.
- **D-sala-2** — Com a sala em `playing` e nenhum humano conectado, **os bots
  pausam**. A partida congela exatamente onde parou e retoma quando alguém
  entra. Bot não termina partida sozinho.
- **D-sala-3** — Identidade do jogador é um `clientId` gerado no navegador e
  guardado em `localStorage`. É opaco para o servidor (string, ≤ 64 chars) e não
  é enviado a outros clientes. Cliente que não mandar `clientId` recai no
  `sessionId` — comportamento idêntico ao de hoje.
- **D-sala-4** — Dono é o `clientId` do criador e ele **não perde a posse ao
  sair**. Enquanto o criador estiver ausente, o humano conectado mais antigo é
  **dono interino**; o criador retoma a posse ao voltar.
- **D-sala-5** — Assento pertence ao `clientId`. Voltar à sala em partida só é
  permitido a quem tem assento guardado que esteja com bot; qualquer outro
  `joinById` durante `playing`/`finished` é recusado.
- **D-sala-6** — Código de sala = duas palavras pt-BR sem acento
  (`morango-exemplar`), exibido com espaço e aceito de qualquer jeito
  (maiúscula, acento, espaço, hífen). Colisão: sorteia de novo até 10 vezes;
  esgotou, mantém o id do Colyseus.

---

## 1. `packages/shared` — código de sala legível

### 1.1 Novo arquivo `packages/shared/src/room-code.ts`

Três funções puras, sem dependência (não usar Zod aqui):

```ts
/** Substantivos e adjetivos pt-BR, minúsculos, sem acento e sem hífen. */
const SUBSTANTIVOS = ["morango", "abacaxi", "pandeiro", ...] as const; // ≥ 60
const ADJETIVOS = ["exemplar", "veloz", "tranquilo", ...] as const;    // ≥ 60

/** "morango-exemplar". `rand(n)` devolve inteiro em [0, n). */
export function generateRoomCode(
  rand: (maxExclusive: number) => number = (n) => Math.floor(Math.random() * n),
): string;

/** "morango-exemplar" → "morango exemplar" (exibição). */
export function formatRoomCode(code: string): string;

/** "  Morangô Exemplar " → "morango-exemplar" (entrada do usuário e URL). */
export function normalizeRoomCode(raw: string): string;
```

`normalizeRoomCode`: `trim` → `toLowerCase` → `normalize("NFD")` → remove
diacríticos (`/\p{Diacritic}/gu`) → troca tudo que não for `[a-z0-9]` por `-` →
colapsa hífens repetidos → tira hífen das pontas. Precisa ser **idempotente**
(`normalize(normalize(x)) === normalize(x)`) e precisa preservar os ids antigos
de 9 caracteres do Colyseus — por isso `0-9` entra no conjunto permitido, e
**cuidado**: `toLowerCase` faz `xKf9aQ2mZ` virar `xkf9aq2mz`, que não casa com o
id original. Como todo `roomId` novo passa a ser slug, isso só afeta salas
criadas antes do deploy; aceitável (elas morrem em minutos).

Listas: 60 × 60 = 3600 combinações. Palavras curtas, fáceis de ditar por
telefone, sem acento nem trocadilho ambíguo ("sessão/seção"). Reaproveitar o tom
do pool de `names.ts` (comida, bicho, objeto brasileiro).

### 1.2 Reexportar em `packages/shared/src/index.ts`

Junto do bloco de `names.js` (`index.ts:15-20`):

```ts
export {
  generateRoomCode,
  formatRoomCode,
  normalizeRoomCode,
} from "./room-code.js";
```

### 1.3 `SnapshotMessage`: trocar `ownerSessionId` por `isOwner`

Em `packages/shared/src/index.ts:91-115`:

```diff
-  /** sessionId do dono da sala (quem pode preencher com bots). */
-  ownerSessionId: string;
+  /** true se ESTE cliente é o dono (ou dono interino) da sala. */
+  isOwner: boolean;
```

O snapshot já é montado por cliente (`room.ts:889-894`), então mandar o booleano
pronto é mais barato e mais seguro que expor identidade de terceiro — e mata a
comparação `mySessionId === snap.ownerSessionId` do cliente (`store.ts:379`),
que é justamente o que quebra no F5.

---

## 2. `apps/server` — código de sala no `onCreate`

Em `room.ts`, dentro de `onCreate` (`room.ts:198`), **antes** de qualquer outra
coisa:

```ts
this.roomId = this.pickRoomCode();
```

```ts
/** Slug legível e livre; cai no id do Colyseus se as 10 tentativas colidirem. */
private pickRoomCode(): string {
  for (let i = 0; i < 10; i++) {
    const code = generateRoomCode((n) => randomInt(n));
    if (!matchMaker.getLocalRoomById(code)) return code;
  }
  return this.roomId;
}
```

- `import { matchMaker } from "colyseus";` — `getLocalRoomById` é síncrono e
  olha o registro local do processo (a VPS roda um processo só, ver
  `docs/f6-operations.md`).
- `randomInt` de `node:crypto` já está importado (`room.ts:6`).
- O setter de `roomId` **só aceita escrita durante o `onCreate`**; fora dele
  lança `ServerError`. Não mover essa linha para `onJoin`.

---

## 3. `apps/server` — identidade do navegador (`clientId`)

### 3.1 Ler e guardar

Helper no topo do `room.ts`:

```ts
/** Identidade do navegador; sem ela, cai no sessionId (identidade da conexão). */
function readClientId(
  client: Client,
  options?: Record<string, unknown>,
): string {
  const raw = options?.["clientId"];
  return typeof raw === "string" && raw.trim().length >= 8
    ? raw.trim().slice(0, 64)
    : client.sessionId;
}
```

No `onJoin`, logo após obter o `clientId`:

```ts
client.userData = { clientId };
```

`userData` é copiado para o cliente novo em `allowReconnection` (`Room.mjs`:
`newClient.userData = previousClient.userData`), então a identidade atravessa a
reconexão sem mapa extra. Ler de volta com:

```ts
private clientIdOf(client: Client): string {
  const data = client.userData as { clientId?: string } | undefined;
  return data?.clientId ?? client.sessionId;
}
```

### 3.2 Campos novos / removidos

```diff
-  /** Dono da sala (primeiro a entrar). */
-  private ownerSessionId: string | null = null;
+  /** Dono de verdade: clientId de quem criou a sala. Nunca é sobrescrito. */
+  private ownerClientId: string | null = null;
+
+  /** clientId → assento guardado (para retomar depois do F5 / rejoin). */
+  private seatByClient = new Map<string, number>();
```

`seatByClient` cresce com visitantes distintos; numa sala de 4 assentos isso é
ruído. Marcar com
`// ponytail: cresce com visitantes distintos; se um dia importar, podar no dispose`.

### 3.3 Dono e dono interino

```ts
/** Dono efetivo: o criador se estiver conectado; senão, o humano mais antigo. */
private effectiveOwnerClientId(): string | null {
  for (const c of this.clients) {
    if (this.clientIdOf(c) === this.ownerClientId) return this.ownerClientId;
  }
  for (const sessionId of this.occupied.keys()) {
    const c = this.clients.find((x) => x.sessionId === sessionId);
    if (c) return this.clientIdOf(c);
  }
  return null;
}

private isOwnerClient(client: Client): boolean {
  const owner = this.effectiveOwnerClientId();
  return owner !== null && this.clientIdOf(client) === owner;
}
```

`occupied` é um `Map`, então `keys()` preserva a ordem de entrada — o "humano
mais antigo" sai de graça daí.

Substituir as três comparações por `sessionId`:

- `room.ts:416` — `if (this.isOwnerClient(client)) this.startGame();`
- `room.ts:467` — `if (!this.isOwnerClient(client)) return;` (fillBots)
- `room.ts:500` — `if (!this.isOwnerClient(client)) return;` (swapSeats)

**Apagar** os três blocos que remendavam `ownerSessionId` na troca de sessão:
`room.ts:266-269`, `room.ts:311-313` e `room.ts:359-361`. Com `clientId` eles
deixam de existir — é o ponto do slice.

### 3.4 Snapshot

Em `sendSnapshot` (`room.ts:972-988`):

```diff
-      ownerSessionId: this.ownerSessionId ?? "",
+      isOwner: this.isOwnerClient(client),
```

---

## 4. `apps/server` — a sala persiste

### 4.1 Constantes e timer

```ts
/** Sala vazia (nenhum humano conectado) sobrevive esse tempo. D-sala-1. */
const EMPTY_ROOM_TTL_MS = 5 * 60_000;
```

```ts
/** Timer do descarte por inatividade. */
private emptyTimerId: ReturnType<typeof setTimeout> | null = null;
```

```ts
/** Arma o descarte. `ms` só é passado nos testes. */
private armEmptyTimer(ms: number = EMPTY_ROOM_TTL_MS): void {
  this.clearEmptyTimer();
  this.emptyTimerId = setTimeout(() => {
    this.emptyTimerId = null;
    if (this.closing) return;
    this.closing = true;
    this.clearBotTimer();
    void this.disconnect().catch((error: unknown) => {
      logger.error(error, "Failed to close idle TrucoRoom");
    });
  }, ms);
}

private clearEmptyTimer(): void {
  if (this.emptyTimerId !== null) {
    clearTimeout(this.emptyTimerId);
    this.emptyTimerId = null;
  }
}

/** Chamar no fim de TODA saída: sem humano conectado, começa a contagem. */
private armEmptyTimerIfEmpty(): void {
  if (this.occupied.size === 0) this.armEmptyTimer();
}
```

### 4.2 `onCreate`

```ts
// ponytail: sem autoDispose a sala só morre pelo nosso TTL — toda saída
// precisa passar por armEmptyTimerIfEmpty(), senão vaza sala pra sempre.
this.autoDispose = false;
this.armEmptyTimer();
```

Armar já no `onCreate` cobre a sala criada e nunca ocupada (com
`autoDispose = false` o Colyseus não recolhe mais o `seatReservationTimeout`).

### 4.3 `onDispose`

```ts
override onDispose(): void {
  this.clearBotTimer();
  this.clearEmptyTimer();
}
```

### 4.4 `onLeave` — trocar os três fail-closed pelo TTL

Reescrever `room.ts:252-391` mantendo a estrutura por status:

- **`waiting`** (`room.ts:258-273`): mantém `occupied.delete`, devolve o assento
  a `freeSeats`. **Não** apagar `seatByClient` (é o que permite retomar). Apagar
  o bloco de transferência de posse (§3.3). Terminar com
  `this.broadcastSnapshots([]); this.armEmptyTimerIfEmpty();`.
- **`playing`** (`room.ts:275-331`): substituir o bloco
  `if (this.occupied.size === 0) { ... disconnect ... }` (`room.ts:279-289`)
  por: marca o assento como bot, publica a mensagem de sistema, e então

  ```ts
  if (this.occupied.size === 0) {
    this.pauseBots(); // §5
    this.armEmptyTimer();
  } else {
    this.scheduleBotTurn();
  }
  ```

  O `await this.allowReconnection(client, RECONNECT_SECONDS)` continua igual
  para saída involuntária; no `then` de sucesso, além de devolver o assento,
  chamar `this.clearEmptyTimer()` e `this.scheduleBotTurn()` (os bots podem
  estar pausados). No `catch`, `this.armEmptyTimerIfEmpty()`.

- **`finished`** (`room.ts:333-390`): apagar os dois `disconnect()` e deixar só
  `occupied.delete` + `armEmptyTimerIfEmpty()`. A espera de 15 s por reconexão
  pode sumir junto — o TTL de 5 min já cobre o caso com folga e o bloco inteiro
  vira quatro linhas.

Depois dessa seção o **único** `disconnect()` do arquivo é o do `armEmptyTimer`.
Se sobrar outro, é bug.

### 4.5 `onJoin` desarma o timer

Primeira linha de `onJoin`: `this.clearEmptyTimer();`.

---

## 5. `apps/server` — bots pausam sem humano

### 5.1 Pausa

```ts
/** Cancela o dispatch pendente E libera o latch — esquecer o latch trava o bot. */
private pauseBots(): void {
  this.clearBotTimer();
  this.botDispatching = false;
}
```

`botDispatching` é setado em `dispatchBotAction` (`room.ts:754`) e só volta a
`false` dentro do callback (`room.ts:758`). Cancelar o timer sem zerar o latch
deixa `scheduleBotTurn` (`room.ts:716`) em no-op permanente: a partida nunca
mais anda. É a armadilha número um deste slice.

### 5.2 Guardas

Em `scheduleBotTurn` (`room.ts:715-719`), junto das outras guardas:

```ts
if (this.occupied.size === 0) return; // D-sala-2: sem humano, partida congela
```

E no começo do callback de `dispatchBotAction` (`room.ts:759`), a mesma linha —
cobre o timer que já estava no forno quando o último humano caiu.

### 5.3 Retomada

Onde um humano volta a ocupar assento, chamar `this.scheduleBotTurn()`: `onJoin`
(caminho de retomada, §6) e o `then` do `allowReconnection`.

---

## 6. `apps/server` — retomar assento (`onJoin`)

### 6.1 Destravar a sala

Em `startGame` (`room.ts:455-463`), remover `void this.lock();`.

Sala travada recusa `joinById` no matchmaker, o que impede a retomada. O
controle de quem entra passa a ser o `onJoin` (fail-closed, abaixo) — mais
preciso que o lock, porque precisa distinguir "é o dono do assento" de
"estranho". O auto-lock do Colyseus por `maxClients` continua valendo e volta
sozinho quando os 4 assentos têm cliente conectado.

### 6.2 `onJoin` reescrito

```ts
override onJoin(client: Client, options?: Record<string, unknown>): void {
  this.clearEmptyTimer();

  const clientId = readClientId(client, options);
  client.userData = { clientId };
  const remembered = this.seatByClient.get(clientId);

  // Partida em curso: só volta quem tem assento guardado que está com bot.
  if (this.status !== "waiting") {
    if (remembered === undefined || !this.botSeats.has(remembered)) {
      client.leave();
      this.armEmptyTimerIfEmpty();
      return;
    }
    this.botSeats.delete(remembered);
    this.occupied.set(client.sessionId, remembered);
    const nickname = this.nicknames.get(remembered) ?? `Jogador ${remembered + 1}`;
    this.pushSocial({ kind: "system", t: Date.now(), text: `${nickname} voltou.` });
    this.scheduleBotTurn();
    return; // pushSocial já faz broadcast
  }

  // Lobby: prefere o assento guardado, se ainda estiver livre.
  const seat =
    remembered !== undefined && this.freeSeats.includes(remembered)
      ? remembered
      : this.freeSeats[0];
  if (seat === undefined) {
    client.leave();
    return;
  }
  this.freeSeats = this.freeSeats.filter((s) => s !== seat);
  this.occupied.set(client.sessionId, seat);
  this.seatByClient.set(clientId, seat);

  const nickname = /* igual a room.ts:237-241 */;
  this.nicknames.set(seat, nickname);

  if (!this.ownerClientId) this.ownerClientId = clientId;

  this.broadcastSnapshots([]);
}
```

Detalhe: hoje o assento sai de `freeSeats.shift()` (`room.ts:228`); com a
preferência pelo assento guardado vira `filter`. Manter `freeSeats` ordenado não
importa mais para o `shift`, mas `handleFillBots` e `swapSeat` dependem da
ordenação — não mexer nisso.

### 6.3 Manter `seatByClient` coerente — armadilha

Três lugares reescrevem assento e **todos** precisam atualizar o novo mapa (o
mesmo tipo de bug que o plano do lobby já documentou para as quatro estruturas
indexadas por assento):

1. `swapSeat(a, b)` (`room.ts:510-551`): depois de trocar `occupied`,
   `botSeats`, `nicknames` e `freeSeats`, trocar também as entradas de
   `seatByClient` que apontam para `a` e `b`.
2. `normalizeHumanSeats()` (`room.ts:554-570`): reconstruir `seatByClient` a
   partir do novo `occupied` (o `clientId` sai de `clientIdOf` do cliente
   correspondente).
3. `handleFillBots` (`room.ts:465-497`): os assentos que viram bot não podem
   continuar reservados a ninguém — remover do `seatByClient` qualquer entrada
   apontando para assento recém-ocupado por bot.

Teste de mesa obrigatório antes de commitar: dono cria sala → convida humano →
troca os assentos dos dois → dono dá F5 → dono volta no **assento novo**, ainda
como dono.

---

## 7. `apps/web` — identificador, código e dono

### 7.1 Novo `apps/web/src/utils/clientId.ts`

```ts
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
```

Chamar uma vez no módulo do store (`const CLIENT_ID = getClientId();`) — não por
chamada, para o `catch` não gerar identidade nova a cada join.

### 7.2 `apps/web/src/store.ts`

- `createRoom` (`store.ts:626`):
  `client.create("truco", { nickname, clientId: CLIENT_ID })`.
- `joinRoom` (`store.ts:667`):
  `client.joinById(normalizeRoomCode(roomId), { nickname, clientId: CLIENT_ID })`.
- `boot` (`store.ts:806-810`): mesmo par no `joinById` de fallback.
- `setRoomId` (`store.ts:600`): `set({ roomId: normalizeRoomCode(id) })`.
- `applySnapshot` (`store.ts:378-379`):

  ```diff
  -      roomOwnerSessionId: snap.ownerSessionId,
  -      isOwner: mySessionId === snap.ownerSessionId,
  +      isOwner: snap.isOwner,
  ```

  Some com o campo `roomOwnerSessionId` do `StoreState` (`store.ts:125`, `:200`)
  e com a variável `mySessionId` (`store.ts:334`, `:456`, `:757`, `:777`) — ela
  não tem mais nenhum uso.

- `setRoomUrl` (`store.ts:56`) continua igual; o `?sala=` passa a carregar o
  slug, que é justamente o que dá para ditar por telefone.
- **Não** mexer no `clearSession` de `goToHome`/`reset`: sair é sair. O caminho
  de volta é o código da sala (que agora é memorizável) ou o `?sala=` da URL.

### 7.3 `apps/web/src/screens/Lobby.tsx`

`room-code` (`Lobby.tsx:96`) passa a exibir `formatRoomCode(roomId)` — "morango
exemplar". A entrada normaliza de volta, então copiar da tela e colar no input
continua funcionando (os e2e `02-four-humans` e `08-menu` fazem exatamente isso:
leem o `textContent` e preenchem `room-id-input`).

### 7.4 Opcional (fora do mínimo, mas barato)

Guardar o nickname em `localStorage` junto do `clientId` e pré-preencher a Home
(`Home.tsx:39`). Sem isso, quem fecha a aba e volta pelo `?sala=` ainda tem que
digitar o nome antes de "Entrar em sala". Fazer só se a seção 7 fechar rápido.

---

## 8. Testes

### 8.1 Novos — `tests/room-code.test.ts` (shared, puro)

- `generateRoomCode` casa `/^[a-z]+-[a-z]+$/` e é determinístico com `rand`
  injetado.
- Nenhuma palavra das listas tem acento, hífen ou maiúscula
  (`normalizeRoomCode(w) === w` para toda palavra).
- `normalizeRoomCode`: `"  Morangô Exemplar "`, `"MORANGO-EXEMPLAR"` e
  `"morango exemplar"` → `"morango-exemplar"`; idempotência.
- `formatRoomCode(generateRoomCode())` tem exatamente um espaço.

### 8.2 Novos — `tests/sala-persistente.test.ts` (server, `@colyseus/testing`)

Seguir o harness de `tests/f3-server.test.ts` (`connectWithQueue`,
`waitForInQueue`, `syncAndWait`) e o acesso a internals via interface tipada,
como `tests/f7-substituicao.test.ts:22-28`.

1. **Sala sobrevive ao lobby vazio** — cria, conecta, `leave(true)`, espera 300
   ms, `gameServer.connectTo(room, {...})` de novo funciona.
2. **TTL descarta** —
   `(room as unknown as { armEmptyTimer(ms: number): void }) .armEmptyTimer(50)`,
   espera 300 ms, novo join falha.
3. **Dono sobrevive ao F5** — dono entra com `clientId: "dono-1"`, sai, volta
   com o mesmo `clientId`: `snapshot.isOwner === true`.
4. **Dono interino** — dono sai, segundo humano recebe `isOwner === true` e
   consegue `fillBots` + `startGame`; quando o dono volta, `isOwner` volta para
   ele e fica `false` para o interino.
5. **Assento é retomado em partida** — 1 humano + 3 bots jogando, humano sai
   (`leave(true)`), assento entra em `botSeats`; rejoin com o mesmo `clientId`
   devolve o assento e tira de `botSeats`.
6. **Estranho é recusado em partida** — join com `clientId` desconhecido durante
   `playing` não recebe assento.
7. **Bots pausam** — sem humano conectado, o `handNumber`/`phase` do
   `match.state()` não muda em 3 s; ao reentrar, volta a andar.
8. **Código legível** — `room.roomId` casa `/^[a-z]+-[a-z]+$/`.

### 8.3 Existentes que quebram (atualizar, não deletar)

| Arquivo                                                                                                     | O que muda                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tests/shared.test.ts:77-91`                                                                                | `ownerSessionId` → `isOwner: boolean`                                                                 |
| `tests/f3-server.test.ts:215`                                                                               | `expect(snap.ownerSessionId).toBe(...)` → `expect(snap.isOwner).toBe(true)` no cliente certo          |
| `tests/f3-server.test.ts:317-325`                                                                           | idem para "snapshot carries owner…"                                                                   |
| `tests/presentation-store.test.ts:101`, `tests/menu-store.test.ts:162`, `tests/f7-substituicao.test.ts:642` | fixtures de `SnapshotMessage`: trocar o campo                                                         |
| `tests/menu-store.test.ts:204,225,269`                                                                      | `toHaveBeenCalledWith("truco", { nickname })` agora inclui `clientId`; mockar `localStorage` no setup |

O teste `tests/f3-server.test.ts:199` ("owner is transferred…") continua válido
como está no comportamento: o segundo humano vira dono interino e consegue
`fillBots`/`startGame`. Só a asserção do campo muda.

### 8.4 E2E (opcional, se der tempo)

Em `tests/e2e/08-menu.spec.ts`, um caso: dono cria sala, copia o código, dá
`page.reload()`, e continua vendo `start-btn` (só o dono vê, `Lobby.tsx:194`).

---

## 9. Documentação a atualizar

- `README.md` (linhas 37-46 e a lista de funcionalidades): código de sala em
  duas palavras; sala vazia dura 5 minutos; voltar pelo código retoma o assento;
  bots pausam quando ninguém está conectado.
- `docs/decisions.md`: nova seção "Decisões de sala persistente" com D-sala-1 a
  D-sala-6 desta página.

---

## 10. Ordem de execução

Cada passo fecha com `pnpm gate` verde (R4).

1. `packages/shared`: `room-code.ts` + reexport + `isOwner` no `SnapshotMessage`
   - `tests/room-code.test.ts`. (Quebra o build do server e do web — seguir.)
2. `apps/server` §2 e §3: código de sala, `clientId`, dono/dono interino,
   `isOwner` no snapshot.
3. `apps/server` §4: `autoDispose = false`, TTL, limpeza dos três
   `disconnect()`.
4. `apps/server` §5: pausa e retomada dos bots.
5. `apps/server` §6: destravar `startGame`, `onJoin` novo, coerência de
   `seatByClient`.
6. `apps/web` §7.
7. Testes §8 e docs §9.

## 11. Checklist de armadilhas

- [ ] `pauseBots()` zera `botDispatching` (senão a partida trava para sempre).
- [ ] Só existe **um** `disconnect()` no `room.ts`, dentro do `armEmptyTimer`.
- [ ] Toda saída passa por `armEmptyTimerIfEmpty()` — com `autoDispose = false`
      uma saída esquecida vaza a sala para sempre.
- [ ] `onJoin` chama `clearEmptyTimer()` antes de qualquer `return`.
- [ ] `swapSeat`, `normalizeHumanSeats` e `handleFillBots` atualizam
      `seatByClient`.
- [ ] `this.roomId = ...` só dentro do `onCreate`.
- [ ] `onJoin` recusa quem não tem assento guardado quando
      `status !== "waiting"` (a sala não é mais travada por `lock()`).
- [ ] `EMPTY_ROOM_TTL_MS` (300 s) permanece maior que `RECONNECT_SECONDS` (180
      s).
- [ ] `getClientId()` é chamado uma vez por carregamento, não por join.

## 12. Limitação conhecida (documentar, não corrigir)

Quem **fecha a aba** no meio de uma partida perde o `reconnectionToken`
(`sessionStorage`) e, por até 180 s, o assento continua reservado pelo
`allowReconnection` — o matchmaker responde "sala cheia" ao `joinById`, porque o
assento reservado ainda conta em `hasReachedMaxClients()`. Passados os 180 s, a
reserva cai e a retomada por `clientId` funciona normalmente. Saída voluntária
(botão Sair) não reserva nada e é retomável na hora. Se incomodar, o conserto é
rejeitar a reserva pendente quando o mesmo `clientId` reaparece — o que exige um
gancho antes do matchmaker, fora do escopo deste slice.
