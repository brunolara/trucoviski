# Plano UX — pacing, times, avatares e indicadores

Correções de legibilidade da Mesa. Referência: PokerStars (ver §6).

## Diagnóstico (por que está rápido demais)

Duas causas, nas duas pontas:

1. **Servidor**: `BOT_DELAY_MS = 300` em [room.ts](../apps/server/src/room.ts) —
   4 bots encadeiam jogadas a cada 300ms, uma vaza inteira passa em ~1s.
2. **Cliente**: `handleSnapshot` em [store.ts](../apps/web/src/store.ts) aplica
   o snapshot na hora. Quando a 4ª carta fecha a vaza, o engine já move a vaza
   para `completedVazas` **no mesmo dispatch** — o snapshot chega com a mesa
   limpa. O jogador nunca vê a 4ª carta nem quem venceu. Idem para fim de mão.

Só aumentar o delay do bot não resolve (2) — jogadas humanas também fecham vaza.
Precisa de uma **fila de apresentação no cliente**, dirigida pelos `events` que
o snapshot já carrega (`vazaCompleted`, `handFinished`, `trucoRaised`…).

---

## Fase 1 — Pacing (a correção principal)

### 1a. Servidor: delay maior + pausa pós-vaza

Em [room.ts](../apps/server/src/room.ts):

- `BOT_DELAY_MS`: 300 → **1000**.
- Após um dispatch cujos `events` contenham `vazaCompleted` ou `handFinished`,
  agendar o próximo `scheduleBotTurn` com delay maior (**~2000ms**) em vez do
  padrão. Trocar o `setTimeout` fixo de `dispatchBotAction` por um parâmetro
  `delayMs`.

### 1b. Cliente: fila de snapshots com hold por evento

Em [store.ts](../apps/web/src/store.ts), `handleSnapshot` passa a enfileirar em
vez de aplicar direto:

- Nova estrutura interna: `snapshotQueue: SnapshotMessage[]` + flag
  `processingQueue`.
- Processador: aplica o snapshot da frente, e se os `events` dele pedirem
  "hold", espera antes de aplicar o próximo:
  - `cardPlayed` → 600ms (a carta assenta na mesa)
  - `vazaCompleted` → 1800ms (mesa cheia + banner "X venceu a vaza")
  - `trucoRaised` / `trucoAccepted` / `trucoRan` → 1500ms (banner TRUCO!)
  - `handFinished` → 2000ms (banner "+N tentos para time X")
  - demais → 0
- Novo estado `banner: { text: string; team?: Team } | null`, setado ao aplicar
  snapshot com evento relevante e limpo ao fim do hold. A Mesa só renderiza.
- **Exceção**: snapshots onde é a vez do jogador local agir nunca ficam presos
  atrás de holds longos — a fila drena, os holds só regulam a apresentação
  intermediária. Na prática a fila raramente terá >2 itens; manter simples.

Problema resolvido de graça: o banner mostra "quem ganhou a vaza" e "quem ganhou
a mão", que hoje não aparecem em lugar nenhum (só na listinha de vazas).

### Verificação

Partida com 3 bots: cada carta visível ~1s, vaza completa fica na mesa ~2s com
banner do vencedor, truco exibe banner antes da resposta do bot.

---

## Fase 2 — Rodada atual e valor

Dados: `trucoValue` já está no `PlayerView`; vaza atual =
`completedVazas.length + 1`; **número da mão não é exposto** — adicionar
`handNumber` ao `PlayerView` (engine:
[types.ts](../packages/engine/src/types.ts)

- onde monta o playerView; passa pelo wire sem mudança no shared além do tipo
  reexportado).

UI ([Mesa.tsx](../apps/web/src/screens/Mesa.tsx), topBar): substituir o
`metadata.rulesetName` (info de dev, sem valor pro jogador) por:

```
Mão 4 · Vaza 2 · Valendo 3
```

Sempre visível, inclusive valendo 1. Badges `(Mão de Onze)` / `(Ferro!)`
continuam.

---

## Fase 3 — Time vermelho × time azul

Só cliente. Convenção: **time 0 (seats 0/2) = azul, time 1 (seats 1/3) =
vermelho** — constante única `TEAM_COLORS` em Mesa.tsx + variáveis CSS
`--team-blue` / `--team-red` em
[Mesa.module.css](../apps/web/src/screens/Mesa.module.css).

Aplicar a cor do time em:

- Placar: "Nós 🔵 4 × 7 🔴 Eles" (chip colorido em cada lado; manter Nós/Eles
  relativo ao jogador, cor absoluta por time).
- Anel do avatar de cada seat.
- Banner de truco/vitória (Fase 1) na cor do time que agiu/venceu.
- Alerta de truco pendente (`trucoAlert`) na cor do time que pediu.

Conflito a resolver: `SUIT_COLORS` usa vermelho/azul para copas/espadas. Trocar
naipes para o clássico preto/vermelho (♣♠ pretos, ♥♦ vermelhos) para não
competir com as cores de time.

---

## Fase 4 — Avatares

Só cliente, zero deps. O círculo com iniciais já existe; trocar por emoji
determinístico por seat: `AVATARS = ["🤠", "👵", "🧔", "👩‍🌾"]` indexado pelo seat
absoluto (bots e humanos). Nome embaixo, anel na cor do time (Fase 3).

Pulado: upload/escolha de avatar — adicionar se o jogo ganhar auth/perfil.

---

## Fase 5 — Indicador de vez

Já existe `activeAvatar` + texto "Sua vez!". Reforçar (padrão PokerStars: anel
pulsante no jogador ativo):

- Anel pulsante (CSS `@keyframes`, glow amarelo/dourado por cima da cor do time)
  no avatar de `turnSeat`; demais avatares levemente esmaecidos.
- Seta "▶" posicionada apontando para o pod do jogador ativo (ou chip "vez"
  colado no avatar — mais simples, mesma informação).
- Quando `turnSeat === seat`, destacar também a área da mão (borda glow).

Pulado: timer de turno com arco de contagem (PokerStars) — não existe timeout de
turno no servidor; adicionar se/quando houver.

---

## Fase 6 — Sobreviver ao F5 (sala na URL + reconexão)

Hoje o F5 mata a sessão: o `reconnectionToken` do Colyseus só vive em memória. O
servidor **já espera 15s** por reconexão em queda involuntária durante a partida
([room.ts](../apps/server/src/room.ts), `allowReconnection(client, 15)`) — falta
o cliente conseguir voltar.

Em [store.ts](../apps/web/src/store.ts):

- **URL**: ao criar/entrar na sala, gravar `?sala=<roomId>` via
  `history.replaceState` (grátis: link compartilhável). Limpar ao sair
  voluntariamente (`goToHome`) e no fim da partida.
- **sessionStorage**: após `create`/`joinById`/`reconnect`, salvar
  `{ reconnectionToken: room.reconnectionToken, roomId, nickname }`.
  sessionStorage (não local): sobrevive a F5, morre ao fechar a aba — não
  reconecta em sala morta dias depois.
- **No boot** (main.tsx ou init do store):
  1. Tem token salvo → `client.reconnect(token)`; sucesso → registra handlers,
     `sync`, segue.
  2. Falhou (sala fechou / passou dos 15s) ou não tem token, mas URL tem
     `?sala=` → se a sala estava em `waiting`, `joinById` normal (o seat foi
     liberado no onLeave, o rejoin pega um livre). Precisa do nickname salvo.
  3. Nada funcionou → limpa storage/URL, mostra Home com o roomId da URL
     pré-preenchido.
- Limpar o storage nos mesmos pontos que a URL (leave voluntário, `finished`,
  reconexão definitivamente falha).

Limite conhecido: F5 durante a partida com >15s parado → o servidor fecha a sala
(fail-closed atual). Aumentar a janela para 60s é uma linha, se incomodar.

---

## §6 — O que copiar do PokerStars

Comportamentos consolidados que este plano adota:

| PokerStars                                                                 | Aqui                                  |
| -------------------------------------------------------------------------- | ------------------------------------- |
| Delay mínimo fixo entre ações de oponentes, mesmo com decisão instantânea  | Fase 1a (bot delay 1s)                |
| Showdown pausa: cartas ficam expostas, vencedor destacado, só depois limpa | Fase 1b (hold de 1.8–2s pós-vaza/mão) |
| Fila de apresentação desacoplada do estado do servidor                     | Fase 1b (snapshot queue)              |
| Pote e blinds sempre visíveis no centro                                    | Fase 2 (Mão · Vaza · Valendo)         |
| Pods fixos por assento: avatar + nome + stack                              | Fases 3–4                             |
| Anel/arco luminoso no jogador ativo                                        | Fase 5                                |

---

## Ordem e dependências

1 (pacing) e 6 (F5) são independentes entre si e as mais importantes — 6 pode
até vir primeiro, já que facilita testar tudo o resto sem perder a sala. 3 antes
de 4 e 5 (as cores de time alimentam anéis e banners). 2 é isolada e pequena.

Sugestão de execução: **6 → 1 → 2 → 3 → 4 → 5**, com teste manual (3 bots) após
as fases 6 e 1 antes de seguir.
