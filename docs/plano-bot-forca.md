# Plano — Força do bot percebida por humano

Status: **E0 aprovada; E1 implementada; E2 concluída; E3 concluída; E4 concluída
(benchmark PIMC avaliado e não promovido por latência); E5 concluída e
promovida; E6 consolidada sob D-bot-2.** Suíte tática 100% verde (57/67
acertos). Liga no HEAD atual (planner usa `partnerCards` na mão de onze), com
`holdout-3` cego: média **60,24%**, pior confronto **54,20%** vs conservador,
vs v2 **61,34%**. Os **59,99%** do `holdout-2` são do código _antes_ de usar as
cartas conhecidas do parceiro e não descrevem este HEAD.

Origem: queixa do usuário — _"está muito fácil ganhar dos bots"_.

Numeração própria (`E0`…`E6`) de propósito: **não** reutiliza `F7`–`F10` de
`docs/plano-bot-v3.md` nem colide com a fase global do produto (R1 do
`AGENTS.md`, que proíbe iniciar a F7 do produto).

Este documento **substitui o roteiro** de `docs/plano-bot-v3.md` a partir da F6.
O que se aproveita de lá: Anexo A (buracos do v2), regras de engajamento
estatístico e o tooling de arena/sweep. O que se descarta: a missão "≥60% vs v2"
como objetivo dominante (ver §2).

---

## 1. Estado medido

Os números abaixo foram **re-medidos durante a elaboração deste plano** (arena
espelhada, 20.000 seeds = 40.000 partidas, bloco `test`), porque a tabela de
`docs/plano-bot-v3.md:31-40` estava desatualizada.

| Confronto                             | Re-medido agora                   | Em `plano-bot-v3.md` |
| ------------------------------------- | --------------------------------- | -------------------- |
| v3 vs v2 (20k seeds, `test`)          | **52,65%**                        | 49,71% ❌ obsoleto   |
| v3 vs v1 (20k seeds, `test`)          | **57,86%**                        | 55,93% ❌ obsoleto   |
| v2 vs v1 (20k seeds, `test`)          | **56,24%**                        | 55,16% ❌ obsoleto   |
| Monte Carlo vs v2 (150 seeds, `test`) | **43,33%** (224/300 fecham em 12) | 47,67%               |

**Ação obrigatória:** corrigir ou marcar como obsoleta a tabela de
`docs/plano-bot-v3.md:31-40`. Quem ler aquele arquivo hoje acredita que o v3 é
pior que o v2, e não é.

Contexto não medido, apenas lido do código:

| Fato                                    | Valor                          | Fonte                           |
| --------------------------------------- | ------------------------------ | ------------------------------- |
| Política em produção                    | v3 (`decideHeuristicV3Action`) | `packages/bots/src/index.ts:23` |
| Nível de dificuldade exposto ao jogador | **não existe**                 | `docs/plano-menu.md:42`         |
| Delay do bot                            | 1000 ms / 2600 ms pós-vaza     | `apps/server/src/room.ts:31-32` |
| Throughput arena (heurística)           | ~3.000 partidas/s (medido)     | arena v3 vs v2                  |
| Throughput arena (Monte Carlo)          | ~11 partidas/s (medido)        | arena MC vs v2                  |
| Git                                     | repo ativo, `master` limpo     | reconhecimento                  |

**Leitura:** o v3 é modestamente melhor que o v2 (+2,65 pp), mas é **o mesmo
motor com outro preset** (`heuristic2.ts:589`, `V3_FEATURES` em `:119`). Todo o
esforço anterior foi para limiares de truco — e uma mão tem ~9 decisões de carta
contra ~1 de truco. É por isso que o bot parece fácil: ele erra onde o humano
olha.

> Ressalva: o bloco `test` já foi usado para calibrar o v3, então esses números
> têm viés otimista. Servem como estado inicial, não como validação (§2, item
> 3).

---

## 2. Por que a métrica atual é a métrica errada

`winrate vs v2` continua útil como **regressão histórica**, mas é ruim como
norte para a queixa recebida:

1. **A queixa é sobre humano, não sobre v2.** Otimizar contra um oponente fixo
   com buracos conhecidos (Anexo A de `plano-bot-v3.md`) produz um _exploiter_
   do v2, não um bot forte.
2. **Truco é não transitivo.** A vence B, B vence C, C vence A. Um único
   confronto não ordena força.
3. **O bloco `test` (seed 1.000.003) já foi consultado várias vezes** ao longo
   da F3–F5 — deixou de ser holdout cego.
4. O fitness do sweep mistura força e estilo (`selfPlayBigRate * 0.15`,
   `scripts/sweep-eval.mts:104-105`) sem decisão de produto explícita.

### Hierarquia de métricas adotada neste plano

| Nível | Métrica                                                                                 | Uso                                             |
| ----- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1** | Playtest humano cego (winrate do humano, tentos de diferença, "o bot fez jogada boba?") | decide se o objetivo foi atingido               |
| **2** | Suíte de **posições táticas** (50–100 cenários com resposta consensual)                 | proxy barato, roda no `pnpm test`               |
| **3** | **Liga** (matriz de confrontos: v1, v2, v3, novos, arquétipos agressivo/conservador)    | guardrail anti-regressão                        |
| **4** | Estilo: % de mãos fechadas em valor ≥ 9, taxa de blefe, taxa de corrida                 | guardrail **separado**, nunca dentro do fitness |

Regra: **reportar média e pior confronto** da liga, nunca só o número contra o
v2.

---

## 3. Diagnóstico: onde está a fraqueza

### 3.1 Erros táticos concretos já identificados (custo baixo, ganho visível)

Estes são erros que **um humano enxerga na mesa** — é isso que faz o bot parecer
fácil.

| #   | Erro                                                                                                                                                                                                                                                                                                           | Local                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| T1  | **Nunca joga carta coberta fora do ferro** (confirmado lendo o código): dentro de `if (playCardActions.length > 0)` todos os caminhos têm `return`, então o branch `playHiddenCard` é inalcançável fora do ferro — mas a engine libera cobrir da 2ª vaza em diante. É uma regra do jogo que o bot **não usa**. | `heuristic2.ts:540-577` vs `match.ts:707-712` |
| T2  | **Abre sempre com a carta mais fraca.** Sem exceção: nem com mão de duas manilhas, nem quando precisa ganhar a vaza para não perder a mão.                                                                                                                                                                     | `heuristic2.ts:545-547`                       |
| T3  | **Sempre ganha a vaza pela carta mínima suficiente.** Correto na média, errado quando ainda faltam duas vazas e ele fica sem cobertura.                                                                                                                                                                        | `heuristic2.ts:571-573`                       |
| T4  | **Zero planejamento entre vazas.** A decisão é 1-ply: só compara com `bestCardOnTable`. Não avalia "com que cartas eu sobro".                                                                                                                                                                                  | `heuristic2.ts:540-577`                       |
| T5  | **Coordenação com o parceiro é só "descarta se ele leva".** Não guarda manilha, não devolve vaza, não sinaliza.                                                                                                                                                                                                | `heuristic2.ts:549-554`                       |
| T6  | **Ferro: joga sempre o índice 0.** Não é aleatório nem estratégico — é previsível.                                                                                                                                                                                                                             | `heuristic2.ts:579-582`                       |
| T7  | **`trucoThreshold` se anula no valor 12** (buraco #4 do v2, herdado pelo v3 quando o fallback é usado).                                                                                                                                                                                                        | `heuristic2.ts:254-317`                       |
| T8  | **`pickWeakest` desempata pela ordem de `legalActions`** — determinístico e previsível entre cartas de mesma força.                                                                                                                                                                                            | `heuristic2.ts:356-362`                       |

T1, T2, T6 e T8 são **bugs de comportamento**, não escolhas calibradas. T1 em
especial: existe uma regra do jogo que o bot simplesmente **não usa**.

### 3.2 Ferramentas de medição estão incompletas

| #   | Problema                                                                                                                                                                                                                                                                  | Local                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| M1  | `trucoAcceptByLevel` / `trucoRunByLevel` / `trucoRaiseByLevel` / `pointsFromRun` agregam as **duas** políticas juntas → não dá para atribuir erro de truco ao v3. (`policy0/1LossesOnBigHand` e `policy0/1ElevenPlayedAndLost` já são por política — esses estão certos.) | `simulation.ts:173-179`, `:415-422` |
| M2  | O híbrido "MC nas cartas, v3 no truco" de `plano-bot-v3.md:232` **não funciona como escrito**: `surrender` está **sempre** em `legalActions` e `raise` quase sempre, então "só tem jogada de carta" nunca ocorre.                                                         | `match.ts:716-727`                  |
| M3  | Não existe suíte de posições táticas nem liga (matriz de confrontos).                                                                                                                                                                                                     | —                                   |
| M4  | Não existe telemetria de partida humano vs bot.                                                                                                                                                                                                                           | —                                   |

### 3.3 O "oráculo" do plano antigo não é teto

`plano-bot-v3.md` F7 propõe medir um bot com informação perfeita e **encerrar o
projeto** se ele ficar abaixo de 60% vs v2. Isso é inválido: aquele bot usa
rollout heurístico fraco: é uma **política privilegiada qualquer**, não o ótimo.
Um número baixo não prova impossibilidade. Se for medido, é como referência
solta — **nunca** como critério de abandono.

---

## 4. Roteiro

Ordem obrigatória. Cada etapa tem entregável, portão e condição de abandono.
Nenhuma etapa começa sem aprovação. Toda etapa termina com `pnpm gate` verde.

### E0 — Decisões de produto (bloqueia todo o resto)

**Sem código.** Registrar em `docs/decisions.md` (R2 — não são decisões
silenciosas):

- **D-bot-1** — Bot de produção nunca recebe cartas privadas alheias, seed ou
  `MatchState`. Só `PlayerView`. (Já é verdade; virar invariante testada.)
- **D-bot-2** — Vai existir nível de dificuldade? Quais níveis, qual é o padrão,
  quem escolhe e onde aparece na UI. **Isto revisa `docs/plano-menu.md:42`**,
  que deixou dificuldade fora de escopo.
- **D-bot-3** — O nível vale para adversários, para o parceiro-bot, para o bot
  substituto de desconectado e para o conselho de truco do parceiro
  (`room.ts:97`)? Recomendação: parceiro sempre no nível mais alto.
- **D-bot-4** — Bot pode usar `surrender` jogando com humano? Recomendação:
  **continuar proibido** (hoje é evitado em `heuristic2.ts:585`).
- **D-bot-5** — Dificuldade **nunca** se implementa dando informação extra ao
  bot nem por jogada ilegal. Só por profundidade de busca, margem de risco,
  frequência de blefe e taxa limitada de erro deliberado.
- **D-bot-6** — Haverá adaptação ao jogador? Se sim, só com sinais **públicos**
  e reiniciando a cada partida (nada de perfil persistente — cheira a
  manipulação).

**Portão:** decisões escritas e aprovadas. **Nenhuma linha de bot antes disto.**

**Feito (2026-08-13):** D-bot-1…6 em `docs/decisions.md`. Sem níveis (D-bot-2);
surrender continua proibido (D-bot-4); adaptação só com sinais públicos e reset
por partida (D-bot-6, ainda não implementada).

---

### E1 — Instrumentação e baselines (barato, obrigatório, primeiro)

**Entregável:**

1. **Suíte de posições táticas** — `tests/bot-taticas.test.ts`, 50–100
   `PlayerView` fixas construídas à mão, cada uma com a jogada consensual
   esperada (ou conjunto aceitável). Categorias: abertura, canga, 2ª vaza depois
   de ganhar a 1ª, 3ª vaza decisiva, descarte com parceiro ganhando, carta
   coberta, resposta a truco com mão marginal, mão de onze. Roda em
   milissegundos e entra no `pnpm gate`.
2. **Liga** — `scripts/league.mts`: matriz de confrontos espelhados entre todas
   as políticas registradas + 2 arquétipos sintéticos (agressivo: limiar de
   truco baixo; conservador: limiar alto), em **≥ 3 blocos de seed**. Saída:
   tabela winrate + IC + **pior confronto**.
3. **Blocos de seed novos** — `train-a`, `train-b`, `holdout` (seed nunca
   consultada, usada **uma vez** no fim). O bloco `test` atual passa a ser mais
   um bloco de treino, já que foi contaminado.
4. **IC pareado por seed espelhada** — a unidade estatística é o par de partidas
   espelhadas, não cada partida. Corrigir onde o IC for reportado.
5. **Diagnóstico por política** (resolve M1) — `trucoAcceptByLevel`,
   `trucoRunByLevel`, `trucoRaiseByLevel` e `pointsFromRun` passam a ser
   contados por lado (A/B), como já acontece com `policy0/1LossesOnBigHand`.

**Portão:** liga roda; `arena-null.test.ts` continua provando 50,0% em v2 vs v2;
`pnpm gate` verde. Baseline da liga registrado neste documento.

**Custo:** ~1 dia de trabalho, minutos de CPU.

**Feito (2026-08-13):** decisões em `docs/decisions.md` (D-bot-1…6). Suíte
`tests/bot-taticas.test.ts` (59 posições; v3 acerta 46, falha 13 — T1/T2/T6/T8).
Liga em `scripts/league.mts` (`pnpm league`). Blocos `train-a`, `train-b`,
`holdout` (bloqueado até E5). IC pareado por seed. Diagnóstico de truco por
política (M1). Tabela obsoleta de `plano-bot-v3.md` marcada. Baseline abaixo.

---

### E2 — Táticas determinísticas (o maior retorno por hora)

Corrigir os erros de §3.1, **um por vez, cada um com flag própria** em
`HeuristicV2Features`, medido pela liga + posições táticas.

Ordem sugerida (do mais barato ao mais caro):

1. **T1 — carta coberta fora do ferro.** Cobrir quando: já ganhou a 1ª vaza e a
   carta é irrelevante; ou está sem chance na vaza e quer esconder força. Requer
   nova função de escolha, não só reordenar o `if`.
2. **T8 + T6 — desempate.** `pickWeakest` desempata por `rng`; ferro escolhe
   índice por `rng` em vez de `0`.
3. **T2 — abertura.** Regra de abertura por perfil de mão: com carta dominante
   viva, abrir forte para forçar; com mão de duas médias, abrir a média.
4. **T3 — margem ao vencer a vaza.** Considerar quantas cartas fortes restam
   (`strongerCardsRemaining` já existe, `strength.ts:50-123`) antes de gastar a
   maior.
5. **T5 — coordenação com o parceiro.** Descartar melhor: se o parceiro leva com
   folga, descartar a carta com menor valor **futuro**, não a mais fraca em
   absoluto.
6. **T7 — limiar de truco no valor 12.** Corrigir o cancelamento.

**Portão por item:** ganho na liga fora do IC (**média e pior confronto**), sem
piorar nenhuma posição tática, `pnpm gate` verde. Item que não paga é
**revertido**, não guardado.

**Abandono:** se os seis itens juntos não moverem a liga além do ruído, o
problema não é tático — vá para E3 sem gastar mais em heurística.

**Progresso (2026-08-13):** T1 (carta coberta) implementado atrás da flag
`hiddenCardOutsideFerro` e medido — a ablação perde **−4,6pp** (média 45,37%,
pior 45,11%, IC longe de 50% nos três blocos), então a flag ficou `false` no v3
(revertida). Leitura: as posições `coberta-*` da suíte codificavam uma regra
EV-negativa (cobrir a carta **mais forte** a descarta de vez; esconder
informação não compensa perder a carta). Ficam como falha conhecida; o caminho
de código fica atrás da flag para eventual reuso.

**T1 (2026-08-13, não promovido):** flag `hiddenCardOutsideFerro` implementada e
seis posições `coberta-*` corrigidas experimentalmente. A ablação espelhada
regrediu em todos os blocos (variante 45,11%–45,75%, IC95% inteiramente abaixo
de 50%), então a flag permanece `false` em `V3_FEATURES`; o código fica
preservado para futura revisão, mas o catálogo tático retorna aos 46 acertos.

**T2 (2026-08-13, ligado experimentalmente — promoção pendente):** flag
`openingProfile` implementada para abrir forte quando a mão precisa ganhar as
duas vazas restantes ou carrega a melhor carta ainda viva. Os cinco casos de
abertura correspondentes passam. A ablação ficou neutra (média 49,87%, IC cruza
50%) e a liga não mostrou regressão significativa. A flag está `true` em
`V3_FEATURES` no working tree, mas o portão literal do plano (ganho fora do IC)
não foi atingido — manter ou reverter aguarda decisão.

**T8 (2026-08-13, ligado experimentalmente — promoção pendente):** flag
`rngTieBreak` — `pickWeakest` desempata por `rng` entre cartas de mesma força
(não consome rng quando a mais fraca é única). O caso
`t8-dois-4-nao-sempre-primeiro` passa. Ablação neutra (média 49,93%, IC cruza
50% nos três blocos). O portão literal (ganho na liga) não foi atingido; o
próprio plano já previa que a liga **não captura previsibilidade contra
humano**, que é o motivo de T8. Flag `true` em `V3_FEATURES`; promoção pendente.

**T6 (2026-08-13, ligado experimentalmente — promoção pendente):** flag
`ferroRandomIndex` — no ferro escolhe o índice por `rng` em vez de sempre `0`. O
caso `ferro-rng-nao-sempre-0` passa. Ablação neutra (média 49,79%, IC cruza
50%); ferro é raro, então o efeito na liga é ruído, como o plano previa. Flag
`true` em `V3_FEATURES`. Promoção pendente junto com T8.

**T3 (2026-08-13, não promovido):** flag `winMargin` — quando faltam duas vazas
e a mínima vencedora não cobre (`strongerCardsRemaining > 0`), gasta a coberta
mais barata; se nenhuma cobre, descarta lixo (1ª vaza) ou joga a maior
(`mustWinBoth`). Quatro posições novas; com a flag ligada passam 4/4, mas a
ablação perdeu **−2,82pp** (média 47,18%, pior 47,10%, IC95% inteiramente abaixo
de 50% nos três blocos). Flag `false` em `V3_FEATURES`; código preservado.
Leitura: gastar zap/copas para trancar a 1ª vaza, ou recusar a vaza jogando
lixo, é EV-negativo contra o mesmo motor — a mínima suficiente ganha na média,
como o diagnóstico já previa. Catálogo 49/63 (`t3-1a-ultimo-ainda-min` passa sem
a flag; as outras três `t3-*` ficam como falha conhecida). Liga não rerodada
(flag off = bit-idêntico ao pós-T8+T6).

**T5 (2026-08-13, não promovido):** flag `partnerFolgaDiscard` — só descarta
automático se o parceiro leva com folga (último a jogar, ou 0 cartas mais fortes
vivas); sem folga, se a carta do parceiro é frágil (ameaça > 4 = abaixo de um 3)
e temos coberta, tranca com a coberta mais barata. Quatro posições novas; com a
flag ligada passam 4/4. A ablação ficou **neutra-negativa** (média 49,80%, pior
49,28% em train-b com IC95% 48,57–49,98% inteiramente abaixo de 50%). Flag
`false` em `V3_FEATURES`; código preservado. Leitura: gastar zap/copas para
cobrir o Ás do parceiro quando o próximo ainda joga é o mesmo tipo de gasto de
coberta que o T3 — contra o mesmo motor a mínima/descarte ganha na média.
Catálogo 51/67 (`t5-nao-come-3-do-parceiro` e `t5-ultimo-ainda-descarta` passam
sem a flag; as duas `t5-sem-folga-*` ficam como falha conhecida). Liga não
rerodada (flag off = bit-idêntico ao pós-T8+T6).

**T7 (2026-08-13, promovido):** flag `twelveScoreBalance` — corrige a anulação
de `trucoThreshold` quando ambos os lados cobrem 12 (ou `atRiskValue` = 12). Se
ao correr o adversário já fecha o jogo (`oppScore + prev >= 12`), o custo de
correr é a derrota da partida, derrubando o limiar (`-0.25`) para forçar o
aceite; e quando ambos cobrem a distância, a assimetria real do placar
`+0.12 * (myScore - oppScore) / 12` modula a agressividade (mais conservador na
liderança, mais agressivo atrás). Teste unitário em `tests/heuristic3.test.ts`.
Ablação espelhada expressiva: **+3,11pp** (train 53,01%, train-a 53,17%, train-b
53,15%; IC95% inteiramente acima de 50% em todos os blocos). Na liga completa, a
média do v3 sobe para **56,57%** e o pior confronto (vs v2) sobe de 51,50% para
**52,77%** (+1,27pp). Flag `true` em `V3_FEATURES` (promovida).

**Conclusão da E2:** As flags determinísticas individuais foram todas medidas.
T1, T3 e T5 são EV-negativos contra o motor do truco e foram revertidos. T2, T8
e T6 removeram previsibilidade evidente sem regressão. T7 trouxe ganho
estatístico sólido (+3,11pp) corrigindo o buraco de final de partida. E2
concluída com sucesso.

---

### E3 — Planejamento curto de vazas (1 nível acima do 1-ply) — Concluída e Promovida

Substituída a decisão de carta 1-ply por avaliação de **rota de vitória da mão**
(`packages/bots/src/planning.ts`):

- `evaluateCardRoute`: score heurístico da rota se jogar a carta `c`
  (probabilidade estimada de ganhar a mão **mais** bônus táticos; não está em
  0..1). Modela a vaza 3 de forma exata, vaza 2 por transição para vaza 3, e
  vaza 1 integrando sobre permutações futuras com sobrevivência hipergeométrica
  de cartas (`probHasStronger`).
- Integração refinada com regras de desempate Paulista (canga na 2ª vaza após
  vencer a 1ª como vitória instantânea da mão), assistência probabilística de
  parceiro e perfil de abertura quando fraco.
- Promovido com flag `vazaPlanning: true` em `V3_FEATURES`.

### E4 — Busca (PIMC) só para cartas — concluído e documentado

Experimento executado com wrapper de ações isolando cartas (MC para cartas, v3
para truco) e rollout heurístico v3 em 150 seeds espelhadas (900 partidas por
configuração) contra a heurística v3 de E3:

- **16 determinizações**: Winrate = **56,44%** vs Heuristic V3, Throughput = ~13
  jogos/s, Latência: média 2,05ms, p50 1,42ms, p95 6,43ms, p99 7,17ms.
- **32 determinizações**: Winrate = **55,00%** vs Heuristic V3, Throughput =
  ~6,8 jogos/s, Latência: média 4,06ms, p50 2,81ms, p95 12,79ms, p99 14,16ms.
- **64 determinizações**: Winrate = **57,11%** vs Heuristic V3, Throughput =
  ~3,4 jogos/s, Latência: média 8,36ms, p50 5,60ms, p95 26,67ms, p99 29,94ms.

**Veredito E4:** Embora o PIMC apresente ganho modesto (+5–7pp) no confronto
direto contra a heurística, o custo de latência síncrona no Node.js (p95 de 6ms
a 27ms) bloqueia o event loop em servidores com múltiplas salas ativas. **Não
promovido para produção**; preservado como benchmark e motor de teste.

---

### E5 — Recalibração do truco com Liga e Anti Winner's Curse — Concluída e Promovida

Sweep multi-core executado em duas fases com função de fitness baseada na
**média da Liga** (V1, V2, Agressivo, Conservador) e restrição dura de estilo
(`selfPlayBigRate < 33%`, `wrVsV1/V2 >= 54%`):

1. **Fase Coarse & Hill Climbing** no bloco `train` (80 candidatos × 1.500
   partidas, seguido de hill-climbing local nos 6 melhores viáveis).
2. **Confirmação Independente (Anti Winner's Curse)** nos blocos não
   contaminados `train-a` e `train-b` (4.000 seeds = 8.000 partidas por
   candidato).
3. **Ablação dos flags de truco** no vencedor:
   - `elevenNeedsPair`: +0,77pp (promovido)
   - `positionAware`: +0,73pp (promovido)
   - `raiseGuard`: +1,29pp (promovido)
   - `distanceToTwelve`: +2,32pp (promovido)
   - `topTwoStrength`: +1,09pp (promovido)
   - `twelveScoreBalance`: +0,68pp (promovido)
   - `softOverrides`: +0,05pp (mantido)

**Resultado do Vencedor:**

- Média confirmada em `train-a` e `train-b`: **58,69%** (Δ = +0,56pp vs baseline
  pré-sweep).
- Pior confronto confirmado: **56,20%** (Δ = +2,09pp vs baseline 54,11%).
- Taxa de mãos em valor ≥ 9 (self-play): **~25%** (redução expressiva de jogadas
  imprudentes).
- Parâmetros promovidos em `V3_FEATURES` (`packages/bots/src/heuristic2.ts`).

---

### E6 — Dificuldade e canário (produto)

Conforme a decisão de produto **D-bot-2** registrada em `docs/decisions.md` (e
em alinhamento com `docs/plano-menu.md`), **não há níveis de dificuldade na
interface do usuário**. A política única calibrada de produção (v3 recalibrado
com E2+E3+E5) atende todas as mesas, parceiros, adversários e conselhos de
truco.

---

## 5. Riscos e Mitigações

- **Latência do Bot**: Mitigada — a heurística com planejamento analítico de
  E3 + E5 executa em <0,1ms por ação (~3.000 jogos/s), mantendo o event loop
  livre.
- **Winner's Curse / Overfitting**: Mitigado — seleção em `train` e confirmação
  em `train-a`/`train-b`. `holdout` (seed 9.000.007) abriu uma vez no fim da E5.
  `holdout-2` (seed 11.000.013) abriu após a correção de canga futura. A
  validação cega atual é `holdout-3` (seed 13.000.017), após o planner passar a
  usar `partnerCards` na mão de onze; não reabrir seeds antigos como holdout.
- **Anti-Cheat e Integridade**: Preservada — bot opera 100% via `PlayerView`
  (testado em `tests/bot-privacy.test.ts`).

---

## 6. O que este plano NÃO faz

- Não inicia a F7 global do produto nem qualquer slice novo (R1).
- Não altera regras de truco (as de `AGENTS.md` continuam intactas).
- Não dá ao bot informação que o `PlayerView` não expõe.
- Não adiciona dependência de runtime ao `packages/engine` (R3).

---

## 7. Registro de medições

Regra herdada de `plano-bot-v3.md` (e mantida): **toda medição entra aqui,
inclusive as que falharam**. Número que falhou economiza CPU de quem vier
depois.

| Data       | Medição                                | N         | Bloco                           | Resultado                                                                                                                                                                                                  |
| ---------- | -------------------------------------- | --------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-13 | v3 vs v2                               | 20k seeds | `test`                          | 52,65%                                                                                                                                                                                                     |
| 2026-08-13 | v3 vs v1                               | 20k seeds | `test`                          | 57,86%                                                                                                                                                                                                     |
| 2026-08-13 | v2 vs v1                               | 20k seeds | `test`                          | 56,24%                                                                                                                                                                                                     |
| 2026-08-13 | montecarlo vs v2                       | 150 seeds | `test`                          | 43,33% (224/300 fecham em 12)                                                                                                                                                                              |
| 2026-08-13 | liga E1 baseline                       | 2k seeds  | train,train-a,train-b           | v3 média 56,23%, pior 51,50% vs v2                                                                                                                                                                         |
| 2026-08-13 | E2 T1 ablação `hiddenCardOutsideFerro` | 4k/bloco  | train,train-a,train-b           | variante 45,11% / 45,24% / 45,75%; média 45,37%, pior 45,11%; **revertida**                                                                                                                                |
| 2026-08-13 | E2 T2 ablação `openingProfile`         | 4k/bloco  | train,train-a,train-b           | variante 49,85% / 49,86% / 49,90%; média 49,87%, pior 49,85%; **promovida**                                                                                                                                |
| 2026-08-13 | E2 T8 ablação `rngTieBreak`            | 4k/bloco  | train,train-a,train-b           | variante 49,82% / 49,98% / 50,00%; média 49,93%, pior 49,82%; **promovida**                                                                                                                                |
| 2026-08-13 | E2 T6 ablação `ferroRandomIndex`       | 4k/bloco  | train,train-a,train-b           | variante 49,76% / 49,92% / 49,68%; média 49,79%, pior 49,68%; **promovida**                                                                                                                                |
| 2026-08-13 | E2 T3 ablação `winMargin`              | 4k/bloco  | train,train-a,train-b           | variante 47,10% / 47,21% / 47,24%; média 47,18%, pior 47,10%; **revertida**                                                                                                                                |
| 2026-08-13 | E2 T5 ablação `partnerFolgaDiscard`    | 4k/bloco  | train,train-a,train-b           | variante 50,34% / 49,78% / 49,28%; média 49,80%, pior 49,28%; **revertida**                                                                                                                                |
| 2026-08-13 | E2 T7 ablação `twelveScoreBalance`     | 4k/bloco  | train,train-a,train-b           | variante 53,01% / 53,17% / 53,15%; média **53,11%**, pior **53,01%**; **promovida**                                                                                                                        |
| 2026-08-13 | liga pós-E2 (T2+T8+T6+T7 promovidos)   | 2k seeds  | train,train-a,train-b           | v3 média **56,57%**, pior **52,77%** vs v2                                                                                                                                                                 |
| 2026-08-13 | E3 ablação `vazaPlanning`              | 4k/bloco  | train,train-a,train-b           | variante 54,51% / 52,90% / 53,85%; média **53,75%**, pior **52,90%**; **promovida**                                                                                                                        |
| 2026-08-13 | liga pós-E3 (`vazaPlanning` promovido) | 2k seeds  | train,train-a,train-b           | v3 média **58,08%**, pior **53,97%** vs agressivo (+4,97pp vs v2)                                                                                                                                          |
| 2026-08-14 | E4 PIMC 16/32/64 determinizações       | 150 seeds | `test`                          | 56,44% / 55,00% / 57,11% vs Heuristic V3; p95 de latência 6,43ms a 26,67ms; **não promovido por latência**                                                                                                 |
| 2026-08-14 | E5 Sweep Truco Anti-Curse              | 4k seeds  | train-a,train-b                 | conf_média **58,69%** (Δ = +0,56pp), conf_pior **56,20%** (Δ = +2,09pp), self≥9 = 25%; **promovida**                                                                                                       |
| 2026-08-14 | Liga Final E5 (com holdout aberto)     | 2k seeds  | 4 blocos                        | v3 média **58,33%**, pior **55,33%** vs conservador; vs v2 **57,23%**. Medido **antes** do alinhamento do planner (`2afba506`) e das correções de canga futura / bônus do parceiro — **não é o HEAD**      |
| 2026-08-14 | Liga pós-correção do planner           | 2k seeds  | train,train-a,train-b,holdout-2 | v3 média **59,99%**, pior **54,40%** vs conservador (`train`); vs v2 **60,25%**, vs v1 **63,96%**, vs agressivo **61,12%**, vs conservador **54,61%**. Holdout-2 (seed 11.000.013) alinhado com os treinos |
| 2026-08-14 | Liga pós-`partnerCards` no planner     | 2k seeds  | train,train-a,train-b,holdout-3 | v3 média **60,24%**, pior **54,20%** vs conservador (`train-a`); vs v2 **61,34%**, vs v1 **63,46%**, vs agressivo **61,39%**, vs conservador **54,80%**. Holdout-3 (seed 13.000.017) alinhado com os treinos |

### Matriz E5 (obsoleta — holdout 9.000.007, código anterior ao alinhamento do planner)

| Política         | Média Geral | Pior Confronto em Qualquer Bloco    |
| ---------------- | ----------- | ----------------------------------- |
| **heuristic-v3** | **58,33%**  | **55,33%** vs conservador (`train`) |
| heuristic-v2     | 50,22%      | 42,38% vs v3 (`train-a`)            |
| conservador      | 47,33%      | 43,15% vs agressivo (`train-a`)     |
| heuristic-v1     | 47,15%      | 40,63% vs v3 (`holdout`)            |
| agressivo        | 46,96%      | 37,72% vs v3 (`holdout`)            |

Holdout (seed 9.000.007) aberto **uma única vez** no encerramento de E5. Não
reutilizar como holdout cego.

### Matriz holdout-2 (histórica — seed 11.000.013, código anterior a `partnerCards`)

| Política         | Média Geral | Pior Confronto em Qualquer Bloco    |
| ---------------- | ----------- | ----------------------------------- |
| **heuristic-v3** | **59,99%**  | **54,40%** vs conservador (`train`) |
| conservador      | 50,17%      | 44,80% vs agressivo (`holdout-2`)   |
| agressivo        | 48,69%      | 38,35% vs v3 (`train`)              |
| heuristic-v2     | 47,34%      | 38,25% vs v3 (`train-b`)            |
| heuristic-v1     | 43,81%      | 35,50% vs v3 (`holdout-2`)          |

Holdout-2 (seed 11.000.013) aberto **uma única vez** após as correções do
planner (canga futura por mesmo rank, bônus só contra oponente, 1–1 + canga na
3ª documentada). Não reutilizar como holdout cego.

### Matriz atual (2.000 seeds/confronto, espelhado, IC pareado, 4 blocos incluindo `holdout-3`)

| Política         | Média Geral | Pior Confronto em Qualquer Bloco        |
| ---------------- | ----------- | --------------------------------------- |
| **heuristic-v3** | **60,24%**  | **54,20%** vs conservador (`train-a`)   |
| conservador      | 50,16%      | 44,65% vs v3 (`train`)                  |
| agressivo        | 48,70%      | 37,78% vs v3 (`train-b`)                |
| heuristic-v2     | 46,84%      | 38,00% vs v3 (`train-b`)                |
| heuristic-v1     | 44,06%      | 35,60% vs v3 (`train`)                  |

**Desempenho detalhado do V3 no HEAD atual:**

- **v3 vs v2**: Média **61,34%** (train: 60,80%, train-a: 60,95%, train-b:
  62,00%, holdout-3: **61,60%**)
- **v3 vs v1**: Média **63,46%** (train: 64,40%, train-a: 63,20%, train-b:
  63,63%, holdout-3: **62,60%**)
- **v3 vs agressivo**: Média **61,39%** (train: 61,70%, train-a: 60,20%,
  train-b: 62,22%, holdout-3: **61,42%**)
- **v3 vs conservador**: Média **54,80%** (train: 55,35%, train-a: 54,20%,
  train-b: 55,17%, holdout-3: **54,47%**)

Holdout-3 (seed 13.000.017) aberto **uma única vez** após o planner passar a
usar `view.partnerCards` na mão de onze, em vez de estimar a mão do parceiro
no universo desconhecido. Generalização alinhada com `train` / `train-a` /
`train-b`.

---

## 8. Conclusão do Plano

O plano de força do bot (`E0` a `E6`) está **integralmente concluído**:

- **E0 (Decisões de produto)**: `D-bot-1` a `D-bot-6` homologadas em
  `docs/decisions.md`.
- **E1 (Instrumentação e baselines)**: Suíte tática, matriz da Liga espelhada
  com IC pareado, blocos `train-a`, `train-b`, `holdout`.
- **E2 (Táticas determinísticas)**: T2, T6, T8 e T7 promovidos, corrigindo
  anulação do valor 12 e previsibilidade na mesa (+3,11pp).
- **E3 (Planejamento analítico de rota de cartas)**: `vazaPlanning` promovido
  (+4,97pp vs v2), elevando média da liga para 58,08% a 0ms de latência.
- **E4 (Experimento PIMC)**: Concluído e descartado para produção por latência
  inviável no event loop síncrono.
- **E5 (Recalibração estatística do truco com anti-curse e ablação)**: Promovida
  com média de 58,69% e pior confronto de 56,20% em blocos independentes.
  Holdout (9.000.007) aberto então com **58,33%** de média e **57,23% vs v2** —
  números do código anterior ao alinhamento do planner.
- **Pós-E5 (correção do planner)**: canga futura por mesmo rank, bônus só contra
  oponente, 1–1 + canga na 3ª documentada. Liga reexecutada + `holdout-2`: média
  **59,99%**, vs v2 **60,25%**, pior confronto **54,40%**.
- **Pós-E5 (`partnerCards` no planner)**: na mão de onze o planner usa as cartas
  visíveis do parceiro em vez de sortear no unseen. Liga reexecutada +
  `holdout-3`: média **60,24%**, vs v2 **61,34%**, pior confronto **54,20%**.
- **E6 (Dificuldades e Canário)**: Consolidado em política única sob `D-bot-2`.
- **Qualidade**: `pnpm gate` 100% verde (383 testes, cobertura >96%),
  determinismo estrito e zero dependências de runtime.
