# PLANO — TRUCO ONLINE 2D (vibe coding 100%)

> Projeto paralelo, não-sério. Meta dos sonhos: 30 jogadores simultâneos.
> Filosofia: **servidor autoritativo desde o dia 1**, engine de regras pura e
> testável por simulação, humano só entra em decisões pontuais (marcadas com
> 🔶).

---

## 1. Visão e princípios

- Jogo de truco 4 jogadores (2x2), navegador desktop + mobile (PWA), UX em
  primeiro lugar.
- **Anti-cheat por arquitetura, não por feature**: o cliente é burro. Nunca
  recebe carta que não é dele. Toda regra roda no servidor.
- **Engine de regras 100% pura** (TypeScript sem dependências, sem I/O):
  validável por milhares de partidas simuladas bot vs bot, sem UI.
- Vibe coding: código organizado em pacotes pequenos com contratos claros, gates
  de validação automatizados entre fases. O agente valida sozinho; o humano só
  bate martelo nas decisões 🔶.

---

## 2. 🔶 Decisões pontuais (bater o martelo antes da F1)

| #   | Decisão                 | Default recomendado                                                              | Alternativa                                                                                            |
| --- | ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D1  | Variante do truco       | **Paulista** (vira + manilhas dinâmicas, 12 tentos, truco/6/9/12)                | Mineiro (manilhas fixas, 2/4/6/8/10/12). Engine terá `RuleSet` plugável — dá pra ter as duas depois    |
| D2  | Renderização do cliente | **React + DOM/CSS + Framer Motion** (LLM-friendly, temas via CSS, mobile grátis) | Phaser 4 (estável desde abr/2026; melhor pra efeitos pesados, pior pra vibe coding e UI de chat/lobby) |
| D3  | Mão de ferro (11x11)    | Cartas cobertas, vale 3, sem ver as cartas                                       | Algumas mesas jogam normal — configurável no `RuleSet`                                                 |
| D4  | Deploy do servidor      | VPS que você já tem (Docker)                                                     | Fly.io / Railway / Colyseus Cloud. Para 30 CCU qualquer instância de 1 vCPU sobra                      |
| D5  | Persistência            | **SQLite** (log de partidas p/ IA futura + stats). Zero ops                      | PostgreSQL se torneios crescerem                                                                       |
| D6  | Auth                    | **Anônimo com nickname + token no localStorage** (fricção zero)                  | Login social depois, quando tiver torneio                                                              |

---

## 3. Stack

| Camada            | Escolha                                                   | Por quê                                                                                                                |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces + Turborepo                               | Compartilhar tipos entre client/server/engine                                                                          |
| Linguagem         | TypeScript strict em tudo                                 | Type-safety full-stack; Colyseus 0.17 infere tipos do servidor no cliente                                              |
| Servidor          | **Colyseus 0.17** (Node 22)                               | Salas, matchmaking, lobby, reconexão automática, `StateView` p/ estado privado (anti-cheat), `patchRate` delta binário |
| Cliente           | React 19 + Vite + Tailwind + Framer Motion                | Vibe coding confiável, animações de carta/tomate, PWA mobile                                                           |
| Estado do cliente | Zustand (espelho do state Colyseus)                       | Simples, sem boilerplate                                                                                               |
| Engine de regras  | Pacote TS puro, zero deps                                 | Testável, portável (mesmo código valida no server e anima no client)                                                   |
| Testes            | Vitest + fast-check (property-based) + Playwright         | Ver seção 8                                                                                                            |
| Persistência      | SQLite (better-sqlite3) via Drizzle                       | Log de partidas (futuro treino da IA), stats                                                                           |
| Deploy            | Docker Compose VPS; Apache do host → servidor em loopback | 30 CCU = 1 container pequeno                                                                                           |
| Assets            | Sprites de carta em SVG/spritesheet, sons via Howler      | SVG facilita tematização estilo Balatro                                                                                |

---

## 4. Estrutura do monorepo

```
truco/
├── packages/
│   ├── engine/          # ⭐ Regras puras do truco. Zero deps, zero I/O.
│   │   ├── src/deck.ts          # baralho 40 cartas, embaralhamento seedável (PRNG determinístico)
│   │   ├── src/ranking.ts       # força das cartas, manilhas, vira
│   │   ├── src/hand.ts          # máquina de estados de UMA mão (3 vazas, truco, empates)
│   │   ├── src/match.ts         # partida até 12 tentos, mão de onze, mão de ferro
│   │   ├── src/rulesets/        # paulista.ts (default), mineiro.ts (futuro)
│   │   └── src/types.ts         # Card, Suit, GameEvent, PlayerAction...
│   ├── shared/          # Protocolo client<->server (mensagens, DTOs), constantes
│   └── bots/            # Estratégias de IA (interface BotStrategy)
│       ├── src/random.ts        # F2: joga qualquer carta válida
│       ├── src/heuristic.ts     # F4: heurísticas (guarda manilha, blefe %, mão de onze)
│       └── src/strategy.ts      # interface — futuro: MCTS / modelo treinado nos logs
├── apps/
│   ├── server/          # Colyseus: rooms, StateView, chat, persistência
│   │   ├── src/rooms/TrucoRoom.ts
│   │   ├── src/rooms/schema/    # Schemas Colyseus (espelham engine, MAS cartas privadas via StateView)
│   │   └── src/db/              # Drizzle + SQLite (match_log)
│   └── web/             # React
│       ├── src/screens/         # Home, Lobby, Mesa, FimDePartida
│       ├── src/components/mesa/ # Carta, MaoDoJogador, Vira, Placar, BotaoTruco
│       ├── src/components/social/ # Chat inline, EmojiPicker, Tomate (mostrar carta removido)
│       └── src/themes/          # tokens CSS por tema (ver seção 9)
├── AGENTS.md            # regras p/ agentes OpenCode (seção 10)
└── docker-compose.yml
```

**Regra de ouro:** `engine` não importa nada de `server` nem `web`. `server`
importa `engine`. `web` importa só `shared` (tipos do protocolo) — o cliente
NUNCA tem a engine completa rodando lógica de decisão, só helpers de exibição
(ex.: "essa carta é manilha?" dado o vira, que é público).

---

## 5. Regras do truco (spec da engine — variante Paulista)

Referência canônica para os testes. Qualquer ambiguidade encontrada durante
implementação vira pergunta 🔶, não decisão silenciosa do agente.

- **Baralho:** 40 cartas (sem 8, 9, 10). Ordem base:
  `4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3`.
- **Vira e manilhas:** vira-se 1 carta; a manilha é a carta **seguinte** na
  ordem (vira 3 → manilha é 4). Desempate de manilhas por naipe: **♣ (zap) > ♥
  (copas) > ♠ (espadinha) > ♦ (pica-fumo)**.
- **Mão:** melhor de 3 vazas. Vence a vaza a carta mais forte; cartas iguais
  não-manilha **empatam** ("cangam").
- **Empates:** venceu a 1ª vaza e empatou a 2ª → leva a mão. Empatou a 1ª → quem
  vencer a 2ª leva. Empatou 1ª e 2ª → decide a 3ª. Empatou tudo → mão sem
  vencedor, ninguém pontua (🔶 confirmar: algumas mesas dão pro time do "mão").
- **Pontuação da partida:** até **12 tentos**. Mão vale 1 → truco = 3 → seis = 6
  → nove = 9 → doze = 12. Pedido alterna entre times (não pode aumentar a
  própria aposta). Correr entrega os pontos do valor **anterior**.
- **Mão de onze:** time com 11 vê as cartas do parceiro e decide: jogar (mão
  vale 3) ou correr (adversário ganha 1). Não pode pedir truco.
- **Mão de ferro (11x11):** conforme D3 — cartas cobertas, vale 3.
- **Ordem de jogo:** "mão" (primeiro a jogar) rotaciona a cada mão; vencedor da
  vaza abre a seguinte.

---

## 6. Protocolo (cliente → servidor via `room.send`)

Toda ação é validada no servidor (é sua vez? carta é sua? aposta é legal?). Ação
inválida = ignorada + log.

| Mensagem       | Payload                       | Regras                                                                 |
| -------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `playCard`     | `{ cardIndex, faceDown? }`    | Só na sua vez; carta coberta permitida da 2ª vaza em diante (paulista) |
| `callTruco`    | `{}`                          | Escala 3/6/9/12; valida alternância de time                            |
| `respondTruco` | `{ accept \| raise \| fold }` |                                                                        |
| `chat`         | `{ text }`                    | Máx 120 chars, rate-limit 1 msg/2s, sanitizado                         |
| `emote`        | `{ emoji }`                   | Whitelist de emojis; rate-limit 1/1.5s                                 |
| `throwTomato`  | `{ targetSeat }`              | Cosmético; rate-limit 1/3s; broadcast p/ todos animarem                |
| `fillWithBots` | `{}`                          | Só o dono da sala, só no lobby                                         |
| `toggleReady`  | `{}`                          |                                                                        |

**Servidor → clientes:** state sync automático (Colyseus Schema + StateView p/
mãos privadas) + eventos efêmeros (`tomatoThrown`, `chatMessage`, `trucoCalled`)
via broadcast. O recurso de mostrar carta foi removido.

**Anti-cheat (invariantes):**

1. `hand: ArraySchema<Card>` de cada player entra **só** no `StateView` do dono.
   Os demais veem `handCount: number`.
2. Baralho, vira futuro e cartas dos bots existem só na memória do servidor.
3. Shuffle com seed do servidor (registrado no match_log p/ replay/auditoria).
4. Timer de turno server-side (ex.: 25s → auto-joga carta mais fraca) evita
   stall.

---

## 7. Fases e gates

Cada fase termina com um **gate automatizado**. Gate falhou → agente corrige
antes de avançar. Humano só é chamado nos 🔶.

### F0 — Fundação (½ dia de agente)

Monorepo pnpm + Turborepo, TS strict, ESLint + Prettier, Vitest, CI local
(`pnpm gate` roda lint+types+testes), Docker Compose esqueleto. **Gate G0:**
`pnpm gate` verde no repo vazio; `engine` builda sem deps.

### F1 — Engine de regras ⭐ (concluída)

`deck`, `ranking`, `hand`, `match`, ruleset paulista completo (empates, mão de
onze, mão de ferro, escala de truco). PRNG seedável. **Gate G1:**

- Cobertura ≥ 95% na engine.
- Property tests (fast-check): soma de tentos nunca ultrapassa regras, sempre há
  vencedor ≤ N mãos, nenhuma carta duplicada, ações inválidas sempre rejeitadas.
- **Simulação: 10.000 partidas bot-random vs bot-random sem crash, sem estado
  impossível** (script `pnpm sim`).
- Suite de cenários canônicos da seção 5 (empate na 1ª, canga tripla, correr no
  9, mão de onze recusada...).

### F2 — Servidor Colyseus (concluída)

`TrucoRoom` (maxClients 4), schemas + StateView (mãos privadas), lobby nativo do
Colyseus listando salas, `fillWithBots` com bot-random, timers de turno,
reconexão (`onDrop`/`onReconnect` do 0.17), persistência do match_log em SQLite.
**Gate G2:** testes de room com `@colyseus/testing`: 4 clientes simulados jogam
partida completa; **teste de anti-cheat explícito: inspecionar payload bruto
recebido por um cliente e provar que não contém cartas alheias**; reconexão no
meio da mão preserva estado.

### F3 — Cliente jogável (feio, mas funcional; concluída)

React + Vite + Tailwind. Telas: Home (nickname) → Lobby (criar/entrar, preencher
com bots, ready) → Mesa (mão em leque, vira, placar, botão truco com escala,
indicador de vez) → Fim. Zustand espelhando o state. Sem animação bonita ainda.
**Gate G3:** Playwright: 1 humano + 3 bots jogam partida completa via UI; 4 abas
humanas completam uma mão; funciona em viewport 390px (mobile).

### F4 — Social + juice 🍅 (concluída)

Chat inline (balões sobre o avatar, some em 5s), emoji picker, tomate com
animação de arremesso + splat + som; o recurso de mostrar carta foi removido.
Animações Framer Motion (distribuir, jogar, virar), sons (Howler), bot
heurístico substituindo o random. **Gate G4:** Playwright cobre
chat/emote/tomate; rate-limits testados no servidor; bot heurístico vence o
random em ≥ 65% de 2.000 partidas simuladas (prova que a interface `BotStrategy`
funciona).

### F5 — UX mobile + PWA (concluída)

Layout touch-first (cartas maiores, arrastar pra jogar), safe areas, manifest +
service worker (instalável), reconexão visível ("reconectando..."), modo
paisagem opcional. **Gate G5:** Lighthouse PWA instalável; Playwright em device
emulado (iPhone/Android) completa partida; derrubar rede 5s no meio da mão →
volta sem perder estado.

### F6 — Deploy + observabilidade (concluída; adaptada à VPS)

Docker Compose no VPS com um container `server` (cliente estático, HTTP e
WebSocket em `2568`) publicado apenas em loopback; Apache do host faz o proxy e
protege `@colyseus/monitor` em dupla camada com a aplicação. Logs estruturados
(pino), backup local do SQLite; backup externo é pendência operacional.
Cloudflare permanece fora de escopo, sem alterações. **Gate G6: confirmado pelo
humano.** Critérios: partida completa em produção com 4 dispositivos reais;
monitor acessível; smoke test pós-deploy automatizado.

### F7 — Polimento contínuo (backlog)

Tema de cartas #2, ranking simples, espectador, replays (a partir do seed + log
de ações — já persistidos desde F2).

---

## 8. Estratégia de testes (resumo)

1. **Engine (F1):** unit + property-based + simulação massiva. É aqui que mora a
   corretude do truco — se G1 passa, o resto é encanamento.
2. **Servidor (F2):** `@colyseus/testing` com clientes headless + teste de
   vazamento de informação (anti-cheat) como teste de regressão permanente.
3. **E2E (F3+):** Playwright, incluindo mobile emulado. Poucos testes, mas
   fluxos completos.
4. **Bots como QA:** `pnpm sim -- --games 10000` roda em segundos e é o melhor
   detector de regressão de regra. Roda em todo gate.

---

## 9. Preparado para o futuro (decisões de agora que destravam depois)

- **Cartas tematizadas (Balatro-style):** desde F3, componente `<Carta>`
  renderiza por **tokens de tema** (`themes/classico.ts`: frame, fonte, cores
  por naipe, verso, partículas). Novo tema = novo arquivo de tokens + assets,
  zero mudança de lógica. Tema é preferência **do cliente** (cada jogador vê o
  seu).
- **IA que aprende:** (a) interface
  `BotStrategy { decide(view: PlayerView): Action }` desde F2 — trocar cérebro
  sem tocar no resto; (b) **todo match_log já grava seed + sequência de ações +
  resultado** desde F2 → dataset pronto para heurísticas calibradas, MCTS ou
  modelo treinado nos logs; (c) bots recebem `PlayerView` (mesma visão parcial
  de um humano), então nunca "trapaceiam" por acidente.
- **Torneios:** partida já é entidade persistida com `matchId` e resultado;
  torneio = serviço que cria salas com `options.tournamentId` e monta
  chaveamento por cima. Nada a fazer agora além de manter `matchId` no log (já
  previsto).
- **Anti-cheat:** já é o default arquitetural (seção 6). Torneio sério no futuro
  só adiciona: auth real (D6) e detecção de conluio via análise dos logs (que já
  existem).

---

## 10. Config OpenCode (multi-agente)

Mesmo padrão dos seus projetos: 5 agentes + `AGENTS.md` na raiz.

- **orchestrator** _(tier heavy)_ — lê este plano, despacha uma fase por vez,
  nunca pula gate, escala 🔶 pro humano. **Antes de fazer qualquer coisa
  sozinho, delega o trabalho braçal pro scout.**
- **scout** _(tier fast — modelo rápido/barato)_ — subagente de trabalho
  corriqueiro: ler/resumir arquivos, grep/glob no repo, listar estrutura,
  extrair assinaturas de funções, rodar comandos e reportar saída, escrever
  boilerplate mecânico (barrel exports, DTOs espelhados, fixtures de teste,
  README de pacote), aplicar renames/refactors mecânicos ditados por outro
  agente. **Nunca toma decisão de design nem toca na engine de regras.**
- **builder** _(tier mid/heavy)_ — implementa a fase corrente. Proibido: tocar
  em fase futura, mudar decisão D1–D6, adicionar dependência fora da stack sem
  aprovação. Usa o scout para todo o contexto (leituras) antes de escrever.
- **tester** _(tier mid)_ — escreve/roda os testes do gate ANTES de considerar a
  fase pronta; roda `pnpm sim` em toda entrega. Delega ao scout a coleta de
  saídas de teste e cobertura.
- **reviewer** _(tier heavy)_ — checa invariantes: engine sem deps/sem I/O;
  nenhuma carta alheia em payload de cliente; validação server-side em toda
  mensagem; rate-limits presentes. Recebe do scout um digest dos diffs em vez de
  reler o repo inteiro.

### Roteamento de modelos por custo (economia de tokens)

Aproveitando seus provedores em cascata (`cc/` → `gh/` → `agy/`), cada tier
mapeia para o modelo mais barato que dá conta:

| Tier      | Uso                                                                                                                      | Perfil de modelo                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **fast**  | scout: ler, resumir, grep, boilerplate, executar e reportar                                                              | O menor/mais rápido disponível na cascata (ex.: classe haiku/flash/mini) |
| **mid**   | tester, builder em tarefas de encanamento (UI CRUD, configs, glue code)                                                  | Modelo intermediário                                                     |
| **heavy** | orchestrator, reviewer, builder **apenas** em: engine de regras (F1), schemas/StateView (F2), debugging de bug de lógica | Seu modelo top da cascata                                                |

**Regras de economia no `AGENTS.md`:**

- **R1 — Ler é barato, pensar é caro:** nenhum agente mid/heavy lê arquivo
  inteiro "pra se contextualizar". Pede ao scout um resumo direcionado ("o que
  `hand.ts` exporta e qual a máquina de estados?").
- **R2 — Escalar só quando travar:** tarefa começa no tier mais baixo plausível;
  sobe de tier apenas após 2 tentativas falhas no tier atual (gate vermelho ou
  lint/types quebrando).
- **R3 — Exceção fixa:** `packages/engine` e schemas Colyseus são sempre heavy —
  é onde bug custa caro. Todo o resto assume mid/fast por default.
- **R4 — Digest, não dump:** saídas de comandos (testes, sim, coverage) passam
  pelo scout, que devolve só o resumo + linhas de erro relevantes, nunca o log
  bruto no contexto do heavy.

Exemplo de `opencode.json` (ajuste os nomes aos seus provedores reais):

```jsonc
{
  "agents": {
    "orchestrator": {
      "model": "cc/heavy",
      "fallback": ["gh/heavy", "agy/heavy"],
    },
    "reviewer": { "model": "cc/heavy", "fallback": ["gh/heavy"] },
    "builder": { "model": "cc/mid", "fallback": ["gh/mid", "agy/mid"] },
    "tester": { "model": "cc/mid", "fallback": ["gh/mid"] },
    "scout": { "model": "cc/fast", "fallback": ["gh/fast", "agy/fast"] },
  },
}
```

**Regras fixas do `AGENTS.md`:**

1. `pnpm gate` verde é pré-condição para encerrar qualquer tarefa.
2. Ambiguidade de regra de truco → perguntar (🔶), nunca assumir.
3. Todo bug de regra vira primeiro um teste que reproduz, depois o fix.
4. Nunca enviar informação privada de jogador fora do StateView — qualquer PR
   que toque em schema exige rodar o teste de vazamento.
5. Commits pequenos por sub-tarefa; mensagem em português.
6. Roteamento de custo R1–R4 acima é obrigatório; violação (heavy fazendo
   leitura bruta de arquivo) é apontada pelo reviewer.

---

## 11. Riscos e mitigações

| Risco                                                       | Mitigação                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Regras de empate/mão de onze mal implementadas (o clássico) | G1: property tests + cenários canônicos + 10k simulações                                        |
| Agente "esperto" colocar lógica no cliente                  | Regra 4 do AGENTS.md + teste de vazamento permanente                                            |
| UX mobile deixada pro fim                                   | F5 dedicada + gate G3 já exige 390px                                                            |
| Colyseus 0.17 é recente                                     | API estável p/ o que usamos (rooms/schema/StateView); demo oficial de card game como referência |
| Scope creep (é projeto paralelo!)                           | Tudo que não está em F0–F6 vai pro backlog F7                                                   |
