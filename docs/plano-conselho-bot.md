# Plano — Conselho do bot parceiro (truco e mão de onze)

Status: proposta. Requer autorização explícita do humano antes de implementar.

## Problema

Inimigo pede truco, o time é humano + bot. O servidor **cala** o bot de
propósito: `scheduleBotTurn` (`apps/server/src/room.ts:508`) e
`isTeamDecisionReservedForHuman` (`room.ts:583`) reservam decisões de equipe pro
humano. O humano decide sozinho, sem saber se o parceiro tem carta. Mesma coisa
na mão de onze (`room.ts:499`).

O bot já tem a opinião pronta e ela é jogada fora: `computeLegalActions`
(`packages/engine/src/match.ts:646`) dá `accept`/`run`/`raise` a **todo** seat
do time respondedor, e `decideHeuristicV2Action`
(`packages/bots/src/heuristic2.ts:189`) já pesa exatamente o que se pede — só as
próprias cartas (`myMaxStrength`, `holdsTopAliveCard`) mais as condições do jogo
(vaza já ganha, placar, valor em risco). Falta só publicar.

## Solução

Reusar os dois canais que já existem. Zero mudança em engine, shared, protocolo
e cliente.

- **Opinião** = `decideBotAction(this.match.playerView(botSeat))`, já importado
  em `room.ts:20`.
- **Entrega** = `broadcast("chatMessage", { seat, text })`, já usado em
  `room.ts:375`; o cliente já guarda (`apps/web/src/store.ts:444`) e já desenha
  o balão no assento (`apps/web/src/screens/Mesa.tsx:499`).

### 1. `apps/server/src/room.ts` — uma função pura + um método + um campo

Função pura exportada (testável sem servidor). Cobre truco **e** mão de onze,
porque `decideBotAction` já responde as duas: `elevenDecision` play/run
(`heuristic2.ts:155`) e `truco` accept/run/raise (`heuristic2.ts:189`).

```ts
/** 5 personas × 5 veredictos. Só tabela — a decisão vem do bot, não daqui. */
const PERSONAS = [
  {
    accept: "Aceita! Tenho carta.",
    run: "Corre, tô sem nada.",
    raise: "Aumenta! Tô com tudo.",
    play: "Joga! Nossas cartas prestam.",
    fold: "Melhor correr, tá magro aqui.",
  },
  {
    // valentão
    accept: "Aceita isso, parceiro!",
    run: "Corre! Não dá pra segurar.",
    raise: "Sobe pra doze! Tô lascado de bom.",
    play: "Vamo jogar! Eles que se cuidem.",
    fold: "Corre dessa, não vale o risco.",
  },
  {
    // resmungão
    accept: "Pode aceitar, dá pra brigar.",
    run: "Corre logo, tô com lixo.",
    raise: "Aumenta. Eles tão blefando.",
    play: "Joga, mas sem chorar depois.",
    fold: "Corre. Não temos nada aqui.",
  },
  {
    // caipira
    accept: "Aceita sim sinhô, tô bem servido.",
    run: "Corre, uai! Minha mão é fraca.",
    raise: "Aumenta essa, tô com as boa!",
    play: "Bora jogar, tá bom demais.",
    fold: "Foge dessa, num dá não.",
  },
  {
    // analítico
    accept: "Aceita: minha carta cobre.",
    run: "Corre, a chance é ruim.",
    raise: "Aumenta, temos vantagem clara.",
    play: "Joga, o par tá acima da média.",
    fold: "Corre, o par não sustenta.",
  },
] as const;

/**
 * Conselho do bot sobre a decisão de equipe pendente, só a partir da
 * PlayerView dele. A persona é o seat: fixa a partida inteira, sem estado novo.
 */
export function botAdvice(view: PlayerView): string | null {
  const persona = PERSONAS[view.mySeat % PERSONAS.length]!;
  const action = decideBotAction(view);
  if (action?.type === "truco") return persona[action.action] ?? null;
  if (action?.type === "elevenDecision")
    return action.decision === "play" ? persona.play : persona.fold;
  return null;
}
```

Campo novo na sala: `private lastAdviceKey: string | null = null;`

Método novo — o `if` de cada caso espelha `scheduleBotTurn` (`room.ts:496-512`),
só que decide _quem fala_ em vez de _quem age_:

```ts
private maybeAdvise(): void {
  if (this.status !== "playing") return;
  const st = this.match.state();
  if (!st.hand) return;

  // Quem tem a decisão pendente, e qual key identifica esse pedido.
  let team: 0 | 1;
  let key: string;
  if (st.phase === "elevenDecision") {
    team = st.scores[0] === 11 ? 0 : 1;
    key = `${st.handNumber}:onze`;
  } else if (st.hand.trucoPendingTeam !== null) {
    team = st.hand.trucoPendingTeam === 0 ? 1 : 0;
    key = `${st.handNumber}:${st.hand.trucoPendingValue}`;
  } else {
    return;
  }

  if (!this.hasHumanOnTeam(team)) return;   // time só de bot decide sozinho
  const botSeat = this.firstBotOnTeam(team);
  if (botSeat === null) return;             // time só de humano, ninguém pra opinar
  if (this.lastAdviceKey === key) return;   // um conselho por pedido
  this.lastAdviceKey = key;

  const text = botAdvice(this.match.playerView(botSeat as Seat));
  if (text) this.broadcast("chatMessage", { seat: botSeat, text });
}
```

Chamada: **uma linha no fim de `broadcastSnapshots`** (`room.ts:643`).

Por que ali e não em `scheduleBotTurn`: `broadcastSnapshots` é o único ponto por
onde passam todos os caminhos (truco pedido por humano ou por bot, mão de onze
recém-aberta, reconexão, sync). `scheduleBotTurn` tem um
`if (this.botDispatching) return` no topo (`room.ts:488`) que engoliria o caso
de humano pedindo truco com timer de bot pendente. O dedupe por key cobre as
chamadas repetidas de `broadcastSnapshots` (nickname, join) e a escada 3→6→9→12
gera key nova a cada degrau, como deve.

Na mão de onze o bot enxerga as cartas do parceiro (`match.ts:598`,
`partnerCards`) — é a regra do jogo, não vazamento: o humano já vê as mesmas
cartas na tela dele.

### 2. Teste

`tests/bot-advice.test.ts` — vitest puro, sem subir servidor. Monta `PlayerView`
e checa:

- truco pendente + manilha na mão → frase de `accept` da persona do seat;
- truco pendente + 4/5/6 → frase de `run`;
- `elevenDecision` com par forte → frase de `play`;
- seats diferentes com a mesma mão → frases diferentes (persona por seat);
- ação de jogar carta → `null` (não fala fora de decisão de equipe).

Determinístico porque `sharpness: 80` satura a sigmoide longe do limiar
(`heuristic2.ts:78`); os testes de `tests/heuristic2.test.ts` já dependem disso.

## Decisões abertas

1. **Balão dura 5s** (`store.ts:451`) e o humano pode demorar mais pra decidir.
   Proposta: manter 5s nesta fatia. Se incomodar na prática, o conselho vira
   sticky até a decisão sair — mudança só no cliente.
2. **Blefe**: a heurística é estocástica perto do limiar, então o conselho é a
   decisão que aquele bot tomaria _naquele instante_. Como o bot não age (o
   humano decide), não há incoerência visível, e o dedupe impede a frase de
   mudar no meio do pedido.
3. **Persona = `seat % 5`**, não sorteada nem ligada ao nickname. Fixa a partida
   inteira sem campo novo, sem persistência, sem tocar em `fillBots`. Se um dia
   a persona precisar casar com o nome do bot, aí sim vira campo em `botSeats`.

## Fora de escopo

Conselho quando o pedido de truco parte do próprio time (o humano já sabe o que
pediu); persona influenciando a _decisão_ do bot, não só a frase — hoje ela é
puro texto sobre a heurística v2 calibrada, e mexer nisso invalida a arena.

## Custo

~60 linhas em `room.ts` (40 são a tabela de frases), ~40 de teste, 1 arquivo
novo de teste. Nada em `packages/`, nada em `apps/web`.
