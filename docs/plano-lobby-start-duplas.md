# Registro — Lobby: início manual, escolha de duplas e times visíveis

Status: **implementado**. Este documento preserva o roteiro do slice. O dono
preenche vagas, organiza os assentos e inicia a partida; o comportamento atual
está resumido no [README](../README.md).

Escopo: 3 mudanças acopladas no lobby (server + web). Nada de engine. A engine
já trata assento como índice puro (times fixos: **0/2 = time 0 azul**, **1/3 =
time 1 vermelho**), então "escolher duplas" é só **rearranjar quem senta em qual
assento antes de começar**. Nenhuma regra nova.

Invariante que sustenta tudo: enquanto `status === "waiting"` o snapshot não
carrega `view` (`room.ts:888`), ou seja, ninguém viu carta nenhuma — trocar
assentos no lobby é seguro mesmo com a `match` já criada em `onCreate`.

---

## 1. Server (`apps/server/src/room.ts`)

### 1.1 Remover o auto-start

- `onJoin` (`room.ts:218-228`): apagar o bloco que muda `status` para `playing`
  quando o 4º ocupante entra. Passa a **sempre** só `broadcastSnapshots([])`.
- `handleFillBots` (`room.ts:454-463`): apagar o mesmo bloco. `fillBots` só
  ocupa assentos e faz broadcast.
- Extrair o trecho repetido para um único `private startGame()`:

  ```ts
  private startGame(): void {
    if (this.status !== "waiting") return;
    if (this.occupied.size + this.botSeats.size !== MAX_SEATS) return;
    this.status = "playing";
    this.setState({ status: this.status });
    this.broadcastSnapshots([]);
    void this.lock();
    this.scheduleBotTurn();
  }
  ```

### 1.2 Mensagem `startGame`

Em `handleMessage` (junto de `fillBots`, `room.ts:389`):

```ts
if (type === "startGame") {
  if (client.sessionId === this.ownerSessionId) this.startGame();
  return;
}
```

Sem payload, sem validação Zod (não há campos). Silencioso para não-dono, igual
a `fillBots`.

**Decisão (D-lobby-1):** `startGame` exige os 4 assentos ocupados (humanos +
bots). Não preenche bots sozinho — o dono usa "Preencher com Bots" antes. Isso
mantém o botão previsível e o diff mínimo.

### 1.3 Mensagem `swapSeats` (escolha das duplas)

Nova mensagem do dono, só em `waiting`:

```ts
// payload: { a: number; b: number }
```

- Validação em `packages/shared/src/index.ts`, no mesmo estilo dos outros:

  ```ts
  const swapSeatsPayloadSchema = z.strictObject({
    a: z.number().int().min(0).max(3),
    b: z.number().int().min(0).max(3),
  });
  export function validateSwapSeats(
    payload: unknown,
  ): { a: number; b: number } | null;
  ```

- Handler:

  ```ts
  private handleSwapSeats(client: Client, message: unknown): void {
    if (client.sessionId !== this.ownerSessionId) return;
    if (this.status !== "waiting") return;
    const p = validateSwapSeats(message);
    if (!p || p.a === p.b) return;
    this.swapSeat(p.a, p.b);
    this.seatsArranged = true;
    this.broadcastSnapshots([]);
  }
  ```

- `swapSeat(a, b)` troca a ocupação dos dois assentos nas **quatro** estruturas
  que indexam assento — esquecer uma delas é o bug óbvio aqui:
  1. `occupied` (sessionId → seat): reatribui o(s) sessionId(s) encontrados.
  2. `botSeats` (Set<number>): remove/adiciona conforme quem era bot.
  3. `nicknames` (seat → nome): troca os valores.
  4. `freeSeats` (number[]): troca presença e mantém ordenado.

  Vazio troca com ocupado normalmente (mover um jogador para um assento livre é
  o caso mais comum na UI). Vazio↔vazio é no-op inofensivo.

- Novo campo `private seatsArranged = false;`.

### 1.4 Não desfazer a escolha do dono

`handleFillBots` chama `normalizeHumanSeats()` (`room.ts:434`), que reempacota
os humanos em 0..N-1 e **apagaria** o arranjo manual. Guardar:

```ts
if (!this.seatsArranged) this.normalizeHumanSeats();
```

`normalizeHumanSeats` continua servindo o caso "alguém saiu e deixou buraco"
quando o dono não mexeu em nada.

### 1.5 Snapshot: expor os bots

`SnapshotMessage` já manda `nicknames`, mas o lobby não sabe quem é bot nem
distingue "vago" de "ocupado". Adicionar em `packages/shared/src/index.ts:79`:

```ts
/** Assentos ocupados por bots (para o lobby distinguir humano/bot/vago). */
botSeats?: number[];
```

E preencher em `sendSnapshot` (`room.ts:871`): `botSeats: [...this.botSeats]`.

Com `nicknames` + `botSeats`, o cliente deriva: nome presente e seat em
`botSeats` → bot; nome presente e fora → humano; sem nome → vago. Isso também
corrige o placeholder frágil do lobby atual
(`connectedPlayers > s ? "..." : "Vago"`, `Lobby.tsx:39`), que erra assim que os
assentos não são contíguos.

---

## 2. Web — store (`apps/web/src/store.ts`)

- Espelhar `botSeats` no estado (`botSeats: number[]`, inicial `[]`, setado em
  `applySnapshot`).
- Duas ações novas, gêmeas de `fillBots` (`store.ts:683`):

  ```ts
  startGame() { get().room?.send("startGame", {}); },
  swapSeats(a: number, b: number) { get().room?.send("swapSeats", { a, b }); },
  ```

- `createBotGame` (`store.ts:643`) passa a mandar `fillBots` **e** `startGame`:
  o fluxo "Jogar contra bots" da Home não pode ganhar um clique extra.

---

## 3. Web — Lobby (`Lobby.tsx` + `Lobby.module.css`)

### 3.1 Layout por time (substitui a lista plana de 4 assentos)

```
┌─────────────────────────────┐
│  🔵 TIME AZUL      (Nós)    │   ← borda/label em var(--team-blue)
│   S1  Bruno        (você)   │
│   S3  Zé Bot       🤖       │
├─────────────────────────────┤
│  🔴 TIME VERMELHO           │   ← var(--team-red)
│   S2  Maria                 │
│   S4  Vago                  │
└─────────────────────────────┘
```

- Mover `--team-blue`/`--team-red` de `Mesa.module.css:12-13` para `global.css`
  (`:root`) e referenciar nos dois arquivos. Uma cor, uma fonte.
- Time 0 = assentos 0 e 2; time 1 = assentos 1 e 3. O time que contém o meu
  `seat` ganha o sufixo "(Nós)".
- Marcar bots com 🤖 e vagos com estilo esmaecido.
- `data-testid`: manter `lobby-seat-${s}`; adicionar `lobby-team-0` /
  `lobby-team-1`.

### 3.2 Trocar de assento (só o dono)

Duas formas sobre **a mesma ação** `swapSeats(a, b)`:

1. **Toque/clique (obrigatório, funciona em mobile):** 1º clique seleciona o
   assento (estado local `selectedSeat`), 2º clique em outro assento dispara
   `swapSeats`. Clicar no mesmo de novo cancela.
2. **Arrastar e soltar (progressive enhancement, desktop):** HTML5 nativo —
   `draggable`, `onDragStart` guarda o seat, `onDragOver` com `preventDefault`,
   `onDrop` chama `swapSeats`. Zero dependência nova; se o navegador não
   colaborar, o clique continua funcionando.

Estado é do servidor: o snapshot volta e a UI redesenha. Sem estado otimista.
Para não-dono, os assentos não são clicáveis nem arrastáveis (e a dica explica
que só o dono organiza as duplas).

### 3.3 Botão "Começar"

Substitui a mensagem "Partida iniciando!" (`Lobby.tsx:54-56`):

- Visível só para o dono. `data-testid="start-btn"`.
- `disabled` enquanto `connectedPlayers < 4`, com texto de apoio "Faltam N
  jogadores — ou preencha com bots".
- Não-dono com 4/4 vê "Aguardando o dono começar...".

---

## 4. Web — Mesa: deixar o time explícito

A mesa já colore avatares por time (`Mesa.tsx:478`), mas nada **nomeia** o time.

- Placar (`Mesa.tsx:246-270`): trocar `score-team-0/1` de só o número para
  rótulo + número — "Nós 4 × 2 Eles", derivando "Nós" do meu `seatTeam(seat)`.
  Os testes e2e já leem o número com `match(/\d+/)`, então continuam válidos
  (`01-human-with-bots.spec.ts:18`); o `02-four-humans.spec.ts:21` usa
  `replace("Nós: ", "")` + `parseInt`, que quebra se o rótulo vier antes —
  trocar por `match(/\d+/)` lá também.
- Nome do parceiro (relSeat 2) e o meu ganham um traço na cor do time
  (`borderBottom`/`textShadow` em `.seatName`), para o par ficar óbvio sem
  precisar decorar geometria.

---

## 5. Testes

Unitários (Vitest) que assumem o auto-start e precisam de `startGame`:

- `tests/f2-server.test.ts`: o helper `setup4Players` deve mandar `startGame`
  pelo dono depois do 4º join. Corrige `sends playing status after 4th joins` e
  os demais em cascata.
- `tests/f3-server.test.ts`: os testes de `fillBots` (linhas 133, 157, 181, 229,
  269, 423, 470, 535, 575) hoje esperam `playing` logo após `fillBots` —
  acrescentar `startGame` e, em um deles, **assertar que `fillBots` sozinho
  deixa `status === "waiting"`** (é a regressão que o slice cria).
- `tests/f4-server.test.ts:211` e `tests/f7-substituicao.test.ts:243`: mesmo
  ajuste.
- `tests/menu-store.test.ts:215`: `createBotGame` agora manda `fillBots` **e**
  `startGame`; o teste de `createRoom` (linha 198) segue valendo — não manda
  nenhum dos dois.

Novos (arquivo `tests/lobby-duplas.test.ts`, no estilo dos `f*-server`):

1. `startGame` de não-dono é ignorado (`status` continua `waiting`).
2. `startGame` com 3 ocupantes é ignorado.
3. `swapSeats` do dono troca humano↔bot: `nicknames`, `botSeats` e o `seat` do
   snapshot do jogador afetado acompanham a troca.
4. `swapSeats` de não-dono e `swapSeats` depois de `playing` são ignorados.
5. `fillBots` após `swapSeats` **não** renormaliza os humanos (o guard
   `seatsArranged`).
6. Payload inválido (`{a: 9, b: -1}`) é ignorado sem derrubar a sala.

E2E:

- `02-four-humans.spec.ts`: após os 4 joins, `pages[0]` clica em `start-btn`.
- `01-human-with-bots.spec.ts`: o caminho "versus" pelo lobby precisa do
  `start-btn`; o caminho "bots direto" continua sem clique (store cobre).
- Um caso curto novo em `08-menu.spec.ts`: dono clica no assento 1 e depois no
  3, e o nome do jogador aparece dentro de `lobby-team-1`.

---

## 6. Ordem de implementação

1. `shared`: `botSeats` no snapshot + `validateSwapSeats`.
2. `room.ts`: `startGame()` extraído, auto-start removido, handlers `startGame`
   e `swapSeats`, guard `seatsArranged`, `botSeats` no `sendSnapshot`.
3. Testes de server (ajuste dos existentes + `lobby-duplas.test.ts`) — verde
   aqui antes de tocar em UI.
4. `store.ts`: `botSeats`, `startGame`, `swapSeats`, `createBotGame`.
5. `Lobby.tsx` + CSS: times, clique-para-trocar, drag nativo, botão Começar.
6. `Mesa.tsx`: rótulos de time no placar e destaque do parceiro.
7. E2E + `pnpm gate`.

Cada passo é commitável sozinho; só o 3 depende do 2.

---

## O que ficou de fora (e quando faria falta)

- **Arrastar em mobile:** o HTML5 drag não funciona em touch. Coberto pelo
  clique-para-trocar; só valeria uma lib de drag se a UX por clique reclamar.
- **Escolher time explicitamente (botão "entrar no time X"):** redundante, o
  arranjo de assentos já é a escolha de dupla.
- **Não-dono pedir troca / votar:** só se aparecer reclamação de sala aberta.
- **Persistir o arranjo entre partidas:** a sala fecha no fim; não há onde
  guardar sem estado novo.
- **Trocar assento com a partida em andamento:** mudaria mão e ordem de jogo no
  meio da mão — é regra nova, exigiria decisão em `docs/decisions.md`.
