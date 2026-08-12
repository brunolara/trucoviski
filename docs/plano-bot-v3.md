# Plano — Bot v3: chegar a 60% de winrate vs v2

Status: **em execução — F6 (recalibrar).** v3 implementado (F0–F5) e fora do
alvo: **49,7% vs v2**. Os knobs da F5 foram escolhidos a dedo; a varredura com
eles nunca rodou. Revisões desta passagem estão em **Errata / revisão**.

Este documento é a instrução de trabalho para quem for continuar (humano ou
LLM). Leia **Missão**, **Estado medido** e **Regras de engajamento** antes de
tocar em qualquer arquivo. O histórico das fases já feitas está no fim.

---

## Missão

Levar `decideHeuristicV3Action` a **≥ 60% de winrate contra o v2**
(`DEFAULT_FEATURES`), em arena espelhada, seeds de teste, N ≥ 20k partidas — sem
regredir contra o v1 e sem voltar a fechar partidas em mão grande.

Alvo composto (as três linhas, não só a primeira):

| Métrica                                | Alvo      | Hoje       |
| -------------------------------------- | --------- | ---------- |
| Winrate vs v2                          | **≥ 60%** | **49,71%** |
| Winrate vs v1 (não regredir)           | ≥ 55,2%   | 55,93% ✓   |
| Self-play: partidas fechadas em mão ≥9 | < 31,7%   | a medir    |

A segunda linha existe porque winrate contra **um** oponente é gamificável: o v2
tem buracos conhecidos (Anexo A) e um bot pode subir contra ele ficando pior em
absoluto. A terceira é a queixa original do humano na mesa ("o jogo acaba porque
ele pede 12 ou aceita").

**Aviso que vale mais que o alvo:** a F7 existe para descobrir se 60% é
alcançável neste jogo. Se o teste de teto disser que não é, **pare e reporte** —
não gaste CPU perseguindo um número impossível. Truco é informação oculta com
variância altíssima; um bot perfeito não vence sempre.

---

## Estado medido (2026-07-26) — não confie nos números do histórico

Todos abaixo: `runArena` espelhado, `--seed-block test` (seed 1.000.003), 10k
seeds = **20k partidas**, SE ≈ 0,35pp (IC95% ≈ ±0,7pp).

| Confronto                | Winrate do A | Comando                                                                        |
| ------------------------ | ------------ | ------------------------------------------------------------------------------ |
| **v3 vs v2**             | **49,71%**   | `pnpm arena --a heuristic-v3 --b heuristic-v2 --games 10000 --seed-block test` |
| v2 vs v1                 | 55,16%       | `--a heuristic-v2 --b heuristic-v1`                                            |
| v3 vs v1                 | 55,93%       | `--a heuristic-v3 --b heuristic-v1`                                            |
| montecarlo vs v2 (N=300) | 47,67%       | `--a montecarlo --b heuristic-v2 --games 150`                                  |

Throughput medido: **664 partidas/s** (v3 vs v2), 1609 (v2 vs v1), **7** (MC vs
v2). O MC custa ~5ms por decisão — irrelevante para o servidor, caro para
varredura.

### Três leituras dessa tabela, e o que cada uma manda fazer

1. **Os fixes da F5 consertaram o bot e quebraram a calibração.** vs v1 subiu
   (53,57% → 55,93%, agora acima do v2) e vs v2 caiu (52,51% → 49,71%). Isso é
   consistente com o diagnóstico da F5.3: parte do 52,5% anterior vinha de um
   bug (`wonFirst` contado duas vezes) que casava com um buraco do v2. Os knobs
   em `V3_FEATURES` (`heuristic2.ts:119-138`) foram **escolhidos a dedo** na F5
   e o sweep nunca os avaliou. → **F6, obrigatória, antes de qualquer código
   novo.**

2. **O salto pedido é maior que o salto v1→v2.** Uma geração inteira de bot
   comprou +5,2pp contra um oponente claramente pior. 60% vs v2 são +10,3pp
   contra um oponente melhor. Calibração não paga isso. → **F7 mede o teto antes
   de você investir.**

3. **O Monte Carlo já existe e nunca foi julgado direito.** 47,7% (±2,9pp) mas
   com **222 de 300 partidas fechando em valor 12** (v3: 30%). O EV de truco do
   MC está quebrado; o jogo de cartas dele nunca foi medido separado. → **F8/F9,
   híbrido antes de código novo.**

---

## Regras de engajamento

1. **Medir antes de escrever.** Toda afirmação deste documento que não tem
   número ao lado é palpite — inclusive as minhas. Palpite não sobrevive a uma
   arena.
2. **Arena espelhada, sempre.** `mirrored: true` cancela viés de assento/dealer.
   Sem espelho o número é lixo, e `tests/arena-null.test.ts` existe para provar
   que v2 vs v2 dá 50,0%. Rode esse teste se algum resultado surpreender.
3. **N e ruído.** Triagem: N ≥ 5k (SE 0,7pp). Número final: N ≥ 20k (SE 0,35pp).
   **Nunca reporte como resultado uma diferença menor que 2×SE.** Metade dos
   "ganhos" da F3 estavam dentro do ruído.
4. **Train ≠ test.** Calibra na seed 42 (`--seed-block train`), confirma na
   1.000.003 (`test`). Calibrar no test é ajustar a seed, não o bot.
5. **Um termo por vez, com flag próprio.** `HeuristicV2Features` é a máquina de
   ablação (`heuristic2.ts:32-90`). Termo cujo Δ de ablação cai dentro do ruído
   é **deletado**, não mantido "porque não atrapalha".
6. **Três portões em toda mudança**, os do quadro da Missão. Passar um só não
   conta.
7. **Desconfie de número bom.** ≥60% vs v2 sem passar o portão do v1 = exploit
   do v2, overfit de seed ou bug no arena. Nessa ordem de probabilidade.
8. **Não aumente a varredura num espaço já varrido.** Se o sweep não passou o
   portão, o teto é do modelo, não da calibração. Mais candidatos só compram
   overfit.
9. **Atualize este documento** com a tabela de números de cada fase que você
   rodar, incluindo as que falharam. Você depende do que a LLM anterior escreveu
   aqui; a próxima depende de você. Números que falharam economizam CPU.
10. **Comite antes de começar.** Checkpoint F0–F5 + tooling de sweep deve estar
    no git antes da F6. Sem commit você não consegue reverter uma fase que deu
    errado.

---

## Errata / revisão (2026-07-26)

Correções aplicadas antes de executar a F6 — o plano original tinha dois
desalinhamentos entre texto e código:

1. **Dois limiares vs v1, não um.** O fitness (`sweep-eval.mts`) descarta
   candidatos com `wrVsV1 < V2_VS_V1_BASELINE − tol` (~54,7%): isso só exige
   “não pior que o v2”. O **portão da Missão / F6** é mais duro: `≥ 55,2%` (não
   regredir do v3 medido a 55,93%). O `gatePass` do sweep usava o baseline do v2
   e mentia no log (`≥54.7%`); passou a usar **55,2%**.
2. **Portão vs v2:** texto pedia `≥ 53,5%`, código tinha `> 0.535`. Alinhado
   para `≥ 0.535`.
3. **`docs/v3-sweep-result.json` é pré-F5** (sem `selfPlayBigRate`, knobs F5
   zerados/`proposeBaseOffset: 2`). Será substituído pelo artefato da F6 — não
   use o arquivo atual como calibração.
4. **Ordem continua obrigatória.** F6 → F7 (teto) → F8 (atribuição) → F9/F10.
   Não pule para PIMC ou modelo de adversário “porque 60% é longe”: a F7 pode
   matar o alvo em ~5 min de CPU.

---

## Roteiro

Ordem obrigatória. Cada fase tem um portão e uma condição de abandono.

### F6 — Recalibrar (barato, obrigatório, primeiro)

**Por quê:** os knobs da F5 nunca foram varridos. `positionBeatsBonus: 0.08`,
`positionInfoBonus: 0.04`, `runCostWeight: 0.1`, `distDangerWeight: 0.1`,
`proposeBaseOffset: 2.5` são chutes plausíveis escritos à mão
(`heuristic2.ts:119-138`), e o comentário do próprio código admite ("F5.3:
recalibrar — o 2.0 foi treinado com double-count").

O sweep já está pronto e paralelizado (`scripts/sweep-v3.mts`, pool de
`cpus()-2`, fitness com restrição dura vs v1 e self-play — F5.4/F5.5):

```bash
pnpm sweep:v3            # coarse 200×2k → hill climb top-10 → confirm 20k → ablação
```

1. Antes de rodar: **re-medir `V2_VS_V1_BASELINE`** (`sweep-eval.mts:17`, hoje
   0,5474) com N=40k. Medi 55,16% em N=20k — dentro do IC do valor antigo, mas a
   constante é uma restrição dura do fitness e merece precisão. Corrija se
   divergir.
2. Rode o sweep. Grave o vencedor em `V3_FEATURES` e o artefato em
   `docs/v3-sweep-result.json` (o arquivo atual é **pré-F5** — schema antigo,
   sem `selfPlayBigRate`; substitua).
3. Ablação: qualquer flag com Δ dentro do ruído sai do preset e do código.

**Portão:** vs v2 ≥ 53,5% **e** vs v1 ≥ 55,2% **e** self-play ≥9 < 31,7%. (O
discard do fitness continua em ~54,7% — ver Errata #1.)

**Expectativa honesta:** isto recupera ~53%, **não** entrega 60%. É o passo que
tira o bot do vermelho e dá um ponto de partida limpo. Se sair muito acima de
55%, desconfie (regra 7) e confirme com uma seed de teste diferente.

**Não** rode o sweep duas vezes com mais candidatos se o portão não passar
(regra 8). Vá para a F7.

**Runtime esperado:** coarse 200×2k + climb + confirm 5×20k + ablação ≈ 30–90
min no pool `cpus()-2`, dependendo da máquina.

### F7 — O teto: 60% existe?

Antes de investir em modelo novo, descubra qual é o máximo. Um bot com
**informação perfeita** (vê as três mãos) é o limite superior de qualquer
melhoria de política: nenhuma heurística, busca ou rede vence isso.

Implementação mínima (~20 linhas, só para medição):

1. Engine: campo opcional de debug no `PlayerView` (`types.ts:239-256`,
   `computePlayerView` em `match.ts:574`) —
   `readonly allHands?: readonly (readonly Card[])[]`, preenchido **só** quando
   um flag explícito de simulação estiver ligado. Marque com
   `// ponytail: campo de medição, nunca ligado em produção` e um assert em
   teste de que a view normal não o carrega.
2. Bot oráculo: reaproveite `montecarlo.ts`. Ele já determiniza mundos
   (`sampleDeterminization`, `montecarlo.ts:174`) e joga rollouts. Com as mãos
   reais, `samples: 1` sobre o mundo verdadeiro já é jogo com informação
   perfeita (a política de rollout continua sendo heurística — isto é um teto
   **fraco**, e serve: teto fraco já responde a pergunta).
3. Meça `oracle vs v2`, espelhado, N ≥ 2k (o MC roda a 7 partidas/s → ~5 min).

**Decisão, e ela é vinculante:**

| oracle vs v2 | Leitura                                                        | Ação                                                                                |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| < 60%        | 60% é **impossível** neste ruleset — nem cartas na mesa bastam | **Pare.** Reporte o teto e proponha alvo novo (ex.: fechar metade do gap oracle−v3) |
| 60–65%       | Só um bot quase perfeito chega                                 | Siga, mas com expectativa de F9/F10 completas e chance real de falhar               |
| > 65%        | Há folga entre o v3 e o possível                               | Siga; o gap é de política, e é seu para colher                                      |

Registre o número aqui neste documento. É a informação mais valiosa da fase
inteira e ninguém a mediu ainda.

### F8 — Onde está o dinheiro: atribuição por tipo de decisão

Não adivinhe se o problema é jogar carta ou pedir truco. O v3 mexeu **quase só**
em limiares de truco, mas uma mão tem ~9 jogadas de carta e ~1 decisão de truco.

Quatro medições, todas `vs v2`, espelhadas, N ≥ 2k — só fiação de política no
script de arena, zero código de bot:

| Política                             | Mede                         |
| ------------------------------------ | ---------------------------- |
| v3 puro                              | ponto de partida (F6)        |
| v3 nas cartas + **oráculo no truco** | quanto o truco perfeito vale |
| **oráculo nas cartas** + v3 no truco | quanto a carta perfeita vale |
| oráculo puro                         | teto (F7)                    |

Os dois híbridos decompõem o gap. **Todo o trabalho das fases seguintes vai para
o lado que mover mais**, e o outro lado fica congelado. Se o truco perfeito vale
+1pp, pare de mexer em `trucoThreshold` — foi lá que a F3 e a F5 gastaram tudo.

### F9 — Busca (PIMC) no lado que a F8 apontou

O MC medido hoje (47,7%) é ruim **no agregado**, com um sintoma nítido: 74% das
partidas fecham em valor 12. Ou seja o EV de truco dele está quebrado (a
simplificação documentada em `montecarlo.ts:11-16` — o rollout não modela
propostas de truco — é a suspeita óbvia), e isso contamina o julgamento do jogo
de cartas dele.

Passos, do mais barato ao mais caro, cada um medido antes do próximo:

1. **Híbrido MC-cartas + v3-truco.** Em `decideBotAction` (`index.ts:23`): se
   `legalActions` só tem jogada de carta → MC; caso contrário → v3. ~5 linhas.
   Isola o jogo de cartas do MC do EV de truco quebrado. **Esta é a experiência
   mais barata com maior chance de pagar** — faça primeiro.
2. **Política de rollout = v3**, não v2 (`MonteCarloOptions.rolloutPolicy`,
   `montecarlo.ts:52` — default é `decideHeuristicV2Action`). Rollout melhor,
   estimativa melhor.
3. **`samples`** ∈ {50, 100, 200, 400}: quatro medições, não um sweep. Latência
   medida: ~5ms/decisão a 100 amostras, folgado para o servidor.
4. **Truco no rollout** (levantar a simplificação de `montecarlo.ts:11-16`). Só
   se a F8 disser que o truco vale a pena, e só depois de 1–3.

**Portão por passo:** +2pp reais (N ≥ 5k, fora do ruído) e os três portões da
Missão. Passo que não paga é revertido, não "mantido para depois".

Custo de varredura com MC: 7 partidas/s single-core → 20k partidas ≈ 47 min
sequencial, ~8 min no pool de `sweep-v3`. Cabe. Não transforme os knobs de MC
num sweep de 200 candidatos (regra 8).

### F10 — Modelo do adversário (o último recurso, e o mais perigoso)

Inferir força pelo que o adversário pediu/aceitou. Contra o v2 isto é
legitimamente explorável: ele aceita qualquer valor tendo ganho a 1ª vaza e
aceita 12 com a carta mais forte viva (`heuristic2.ts:204-214`, buraco #3).

Pré-requisito: **o `PlayerView` não carrega histórico de apostas**
(`types.ts:239-256`). Precisa de um campo novo — algo como
`readonly trucoHistory: readonly { hand, vaza, team, value, response }[]` —
preenchido em `computePlayerView` (`match.ts:574`). O "fora de escopo: nenhuma
mudança no engine" do v3 **cai aqui**; é pré-requisito, não extra.

**Por que é perigoso:** é o que mais provavelmente entrega os últimos pontos
contra o v2 **especificamente**, e é o que mais provavelmente é overfit ao v2.
Portão triplo, sem exceção: sobe vs v2 **e** não cai vs v1 **e** não piora o
self-play. Se subir vs v2 e cair vs v1, você construiu um exploiter do v2 —
registre isso aqui como resultado negativo e reverta.

---

## Condições de parada

Pare e escreva o resultado neste documento quando qualquer uma valer:

- **60% atingido** com os três portões → promova (`decideBotAction`,
  `index.ts:23`), atualize `V3_FEATURES`, o `docs/v3-sweep-result.json` e a
  tabela de estado deste doc.
- **F7 diz que o teto é < 60%** → pare. O alvo não existe; reporte o teto medido
  e proponha um alvo derivado dele.
- **Três fases seguidas sem +2pp** → pare. Reporte o que cada uma custou e
  entregou. Iterar sem ganho é como a F3 chegou a "52,9%" que não se sustentou.

Não peça mais CPU para o mesmo espaço. Peça um modelo diferente ou um alvo
diferente.

---

## Fora de escopo

`apps/` (web, servidor), protocolo, UI. O bot é `PlayerView → Action`. A única
mudança permitida no engine é campo de informação **no `PlayerView`** (F7, F10);
regra do jogo não se toca.

---

## Histórico — o que já foi feito e medido

### F0–F2 (feitas)

- **F0 — instrumentação:** arena espelhada (cada seed roda com os lados
  trocados), `ArenaDiagnostics` (`simulation.ts:181-214`: valor da mão que
  fechou, mão de onze, accept/run/raise por nível, pontos entregues correndo),
  `--features-a/--features-b` como JSON, `--seed-block train|test`, throughput.
  Portão do teste nulo (v2 vs v2 = 50,0%) virou `tests/arena-null.test.ts`.
- **F1 — `assessHand(view)`:** os fatos de posição/mesa que só existiam dentro
  do passo 4 (e portanto eram invisíveis às decisões de truco, buraco #7) saíram
  para um struct puro calculado no topo. Refactor sem mudança de comportamento.
- **F2 — seis termos, um flag cada:** `elevenNeedsPair`, `positionAware`,
  `raiseGuard`, `distanceToTwelve`, `softOverrides`, `topTwoStrength`
  (`heuristic2.ts:50-90`). Cada um com teste em `tests/heuristic3.test.ts`.

### F3 — varredura (números **obsoletos**, pré-F5)

200 candidatos × 2k train → hill climb top-10 → confirmação 20k test → ablação.

| Métrica                     | Alvo       | Atingido (então)                 |
| --------------------------- | ---------- | -------------------------------- |
| Winrate vs v2               | ≥ 60%      | 52,9% (bruto); 52,5% pós-ablação |
| Winrate vs v1               | ≥ 58%      | 54,2% / 53,6% pós-ablação        |
| Perdas em mão ≥9 vs v1      | cair ≥ 40% | ~19% de queda relativa           |
| Onze jogada e perdida vs v1 | cair ≥ 30% | ~17% de queda relativa           |

Ablação de então: `softOverrides` +0,0072, `elevenNeedsPair` +0,0049,
`topTwoStrength` +0,0034, `raiseGuard` +0,0023 (mantidos); `distanceToTwelve`
+0,0006 e `positionAware` 0,0000 (o vencedor tinha os dois knobs em 0 — Δ=0 era
tautologia, não evidência).

### F4 — promoção (feita)

`decideBotAction` aponta para `decideHeuristicV3Action` / `V3_FEATURES`. O v2
(`DEFAULT_FEATURES`) permanece congelado como oponente de referência de toda
regressão futura.

### F5 — correções pós-auditoria (**implementadas**, sweep pendente)

A auditoria do v3 entregue achou dois termos que não faziam o que o nome dizia,
um bug de dupla contagem e dois vieses no fitness. Tudo está no código; **os
knobs novos nunca foram varridos** — é a F6.

| Item | O que mudou                                                                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5.1 | `distanceToTwelve` virou magnitude: `coverLose`/`coverWin` (razão `atRisk/dist`) no lugar de duas binárias que se anulavam, + `runCostWeight` (custo de correr = nível anterior/V, buraco #9). `heuristic2.ts:275-283`                                                        |
| F5.2 | `positionAware` graduado: `beatsTable` (peso 1 sendo pé, 0,5 antes) e `cardsPlayedInVaza/3` como termos separados. Cobertura do gatilho: 10,5% → ~65%. Inversão de sinal por `mode` removida; knobs assinados. `heuristic2.ts:290-297`                                        |
| F5.3 | **Bug:** `softWonFirstBonus` era subtraído também no `propose`, onde a base já descontava `wonFirst` — o v3 pedia truco em 62,3% das oportunidades após ganhar a vaza 1 (v2: 30,7%), e 9.789 dessas com `myMax < 8` (v2: 876). Agora só no `respond`. `heuristic2.ts:304-308` |
| F5.4 | Fitness: `min(wr_v2, wr_v1)` virou **restrição dura** (`V2_VS_V1_BASELINE`, `sweep-eval.mts:17`) + objetivo único. O `min` nunca foi binding e enviesava o ranking por ruído                                                                                                  |
| F5.5 | Terceira arena no `evaluate`: self-play a `games/4`, porque produção é self-play e a penalidade saía da arena v3-vs-v2                                                                                                                                                        |
| F5.6 | `randomFeatures` passou a **sortear os flags** (`sweep-v3.mts:178-180`) — os 200 candidatos da F3 compartilhavam o mesmo conjunto de 6 flags                                                                                                                                  |
| F5.7 | Dois testes que passavam com o flag desligado; padrão novo é assert do par (`on !== off`)                                                                                                                                                                                     |

Medições que motivaram a F5 (N=40k, pré-fix):

| Medição                                | Valor              |
| -------------------------------------- | ------------------ |
| v3 vs v2                               | 52,51%             |
| v3 vs v1                               | 53,57%             |
| v2 vs v1                               | 54,74%             |
| Onze jogada+perdida (v3/v2, head-head) | 850 / 1180 (−28%)  |
| Perdas em mão ≥9 (v3/v2, head-head)    | 7546 / 7633 (liso) |

Self-play (4k seeds espelhadas, configuração de produção):

| Mão que fecha a partida | v2 vs v2 | v3 vs v3  |
| ----------------------- | -------- | --------- |
| valor 12                | 38,6%    | **18,6%** |
| valor ≥9                | 41,5%    | **31,7%** |

O `raiseGuard` sobrevive **só** pela penalidade de self-play: na ablação,
`raiseGuard=off` tem a maior winrate de todas (0,5300 vs 0,5295) e perde no
fitness por penalidade maior. Manter a penalidade — ela é metade do objetivo,
não desempate.

### Performance da arena (feito, ver `docs/plano-perf-arena.md`)

`strongerCardsRemaining` era 54% de todo o tempo de sweep; virou tabela por vira
(7,2× na função). Sweep paralelizado em pool de processos. Successive halving no
coarse ficou proposto e não feito — opcional.

---

## Anexo A — os 9 buracos do v2

Referência de diagnóstico. Continua válido: o v2 é o oponente congelado, e estes
são os erros que ele comete. Também é a lista de onde um modelo de adversário
(F10) tem o que explorar.

1. **Mão de onze frouxa** (`heuristic2.ts:166-175`): com `sharpness: 80` o
   fallback vira "joga se `teamMax >= 9`" = um **3**, sem manilha. Correr custa
   1 ponto, jogar arrisca a partida.
2. **`myMax >= 12` aumenta sempre** (`:196-202`): ignora nível atual, placar,
   vazas restantes. É o "pede 12". Sem nenhum termo de seleção adversa — quem
   aceita um 12 é quem está melhor.
3. **Dois `accept` incondicionais** (`:204-214`): `wonFirst` aceita qualquer
   valor com qualquer carta; `topAlive` aceita 12 com zap + 4 + 5 na vaza 0.
4. **`trucoThreshold` se anula no 12** (`:112-113`): `oppScore + 12 >= 12` e
   `myScore + 12 >= 12` são ambos sempre verdadeiros → +0.12 −0.12 = 0. Em 9,
   anula sempre que os dois times têm ≥ 3. A sensibilidade a placar está
   desligada justo nos valores que decidem partida.
5. **Mão = uma carta só**: tudo por `myMaxStrength`. `[zap,4,4]` = `[zap,3,3]`.
6. **A escada não carrega informação**: mesmo limiar pra um truco novo (3) e pra
   um re-aumento a 12 depois do seu 9 — o sinal mais forte do jogo.
7. **Posição ignorada**: `isLastToPlay` é dead code na prática, e posição não
   entra em decisão de truco nenhuma. "Sou o pé e bato a mesa" é fato; `myMax` é
   palpite.
8. **Ganhando/perdendo só tem metade**:
   `if (myScore < oppScore) threshold -= 0.08` (`:111`) é binário (11x10 = 1x11)
   e não tem simétrico — o bot **nunca fica conservador com a vantagem**. Falta
   também o "perdendo a mão": perder a vaza 1 tem a mesma base que empatar, e
   precisar vencer as duas restantes nunca é modelado.
9. **"Vale o risco?" tem resposta exata e nunca é calculada**: correr entrega o
   nível anterior (`match.ts:502`), então aceitar bate correr quando
   `p ≥ (V − anterior) / 2V` — 33% num truco novo, **12,5%** num 9→12. Em pontos
   puros aceitar um 12 quase sempre vale; o estrago está no `raise`. A conta só
   deixa de valer quando `V` cobre a distância do adversário até 12.

**Por que a calibração do v2 não pegou nada disso:** os offsets
(`responseBaseOffset`, `proposeBaseOffset`) só mexem nos caminhos da sigmoide.
Os três branches incondicionais (#1, #2, #3) são invisíveis pro knob da arena —
nenhuma varredura os corrige. E a calibração do v2 rodou só contra o v1, que tem
os mesmos pontos cegos.
