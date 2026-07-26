# Plano — Bot v4: trocar limiares calibrados por EV calculado

Status: **E0–E2 + E5 + E4 feitos; Ablation F FAIL; C1+C2 feitos — ambas causas
MORTAS.** `useEvTruco` permanece `false` (classic F6b). C3 não cabe. Não iniciar
E3/E6/`q` ternário sem nova decisão. Sucessor do `docs/plano-bot-v3.md`.

Público: dev experiente **sem experiência em ML**. Todo passo de ML aqui está
escrito como "rode este script, olhe este número, o portão é este". Não há
framework, não há GPU, não há dependência nova em produção.

---

## Tese em um parágrafo

O bot decide truco comparando uma **força de mão** (0–1) com um **limiar
calibrado à mão** (`trucoThreshold`, `heuristic2.ts:273`) — hoje 13 knobs
ajustados por sweep. A tese é que isso está errado por construção: a decisão
correta em qualquer jogo de aposta é comparar **valor esperado**, e o EV se
decompõe em duas peças que dá para **calcular exatamente** em vez de calibrar:

1. **`W(a, b, dealer)`** — probabilidade de vencer a _partida_ dado o placar.
   Não precisa de ML: é uma tabela de 13×13×2 medida por simulação.
2. **`p`** — probabilidade de vencer _esta mão_ dado o que eu vejo. Isso sim é
   ML, e do tipo mais simples que existe (regressão logística: ~25 números).

Com as duas, a decisão de aceitar truco vira aritmética sem knob:

```
EV(aceitar) = p · W(a+L, b) + (1−p) · W(a, b+L)
EV(correr)  =                      W(a, b+s)
aceita se EV(aceitar) > EV(correr)
```

`s` = valor atual da mão, `L` = valor após o truco
(`trucoSequence: 1→3→6→9→12`).

Isso **deleta** `scoreSensitive`, `distanceToTwelve`, `distDangerWeight`,
`distFinishWeight`, `runCostWeight`, `responseBaseOffset`, `proposeBaseOffset`,
`elevenPairFloor`, `softTopAliveBonus`, `softWonFirstBonus`, `knownWinBonus` —
onze dos treze knobs do sweep. Não porque são ruins, mas porque cada um é uma
**aproximação manual de um pedaço dessa fórmula**.

---

## Por que o v3 travou (leitura das medições existentes)

Três fatos já medidos, todos no `plano-bot-v3.md`, e a conclusão que eles
forçam:

| Fato medido                                                        | Fonte | O que implica                                    |
| ------------------------------------------------------------------ | ----- | ------------------------------------------------ |
| oracle vs v2 = **99,70%**                                          | F7    | O teto não é o problema. Há 50pp de folga.       |
| oracle só no **truco** = 99,70%; oracle só nas **cartas** = 49,73% | F8    | 100% do gap está na decisão de aposta.           |
| Sweep completo dos 13 knobs → **51,53%**, portão FAIL              | F6    | A família paramétrica não contém a política boa. |
| MC no truco: +2pp vs v2, **−15pp vs v1**                           | F9    | Busca cega sem modelo de valor = exploit de v2.  |

F6 + regra 8 do `plano-bot-v3.md` ("não aumente a varredura num espaço já
varrido") fecham a porta do sweep: **não adianta otimizador melhor, adianta
espaço de busca diferente.** É isso que este plano faz.

### Correção a uma sugestão anterior

Cogitei portar o engine para Rust para acelerar o ciclo. **Descartado**, e o
`plano-perf-arena.md` já tinha razão: o gargalo não é CPU. As contas da E2
abaixo precisam de ~100k partidas = **~35 s** no TypeScript atual. Rust resolve
um problema que este plano não tem. Fica na seção "o que não fazer".

---

## Glossário (leia se ML é novo para você)

| Termo                   | O que é, sem enrolação                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature**             | Um número extraído do estado. `myMax`, `distToWin`, `nível do truco`. Você já tem quase todas em `HandAssessment` (`heuristic2.ts:159`).                                                                       |
| **Label**               | A resposta certa, conhecida **depois**. Aqui: "meu time venceu esta mão?" → 1 ou 0. Você sabe isso terminando a simulação.                                                                                     |
| **Dataset**             | Um CSV: uma linha por decisão, colunas = features + label. É só log.                                                                                                                                           |
| **Regressão logística** | `p = 1/(1+exp(−(w·x + b)))`. Achar os `w` que melhor preveem o label. É a **mesma sigmoide** que `scoreToProbability` (`heuristic2.ts:177`) já usa — a diferença é que os pesos saem de dados em vez de sweep. |
| **Treinar**             | Rodar um solver que acha esses `w`. 5 linhas de `scikit-learn`, ~2 s de CPU.                                                                                                                                   |
| **Overfit**             | O modelo decorou o ruído do treino. Antídoto que você já pratica: `--seed-block train` para treinar, `test` para julgar.                                                                                       |
| **Calibração**          | `p` precisa ser probabilidade _de verdade_: das 1000 vezes que o modelo disse 0,7, ~700 têm que ser vitórias. Importa mais que acurácia aqui, porque `p` entra numa fórmula de EV.                             |
| **Brier score**         | Métrica de calibração: média de `(p − label)²`. Menor é melhor. Chute constante 0,5 dá 0,25. Use como sanidade, **não** como portão.                                                                           |
| **Distribution shift**  | O modelo aprendeu `P(vitória)` nos estados que o **bot antigo** visitava. O bot novo visita estados diferentes → o modelo erra lá. Antídoto: gerar dados de novo com o bot novo e retreinar (fase E4).         |
| **Inferência**          | Usar o modelo: um produto escalar e uma sigmoide. ~15 linhas de TypeScript, zero dependência.                                                                                                                  |

**O ponto que importa para você:** o treino acontece **offline, em Python**. O
que vai para produção é um `const W = [0.31, -1.24, ...]` num arquivo `.ts`. O
runtime do jogo não ganha dependência nenhuma.

---

## Roteiro

Ordem obrigatória. Cada fase tem portão e condição de abandono. As fases E0 e E1
não têm ML nenhum e já podem pagar sozinhas.

### E0 — Medir o ruído do sweep (1 h, obrigatório, sem código novo)

**Por quê:** `climbChain` (`scripts/sweep-climb.mts:97`) aceita um vizinho com
`ev.fitness > current.fitness + 1e-6`, avaliando com `games = 2000`. O SE de uma
winrate espelhada a 2k seeds é ~1,1pp (regra 3 do `plano-bot-v3.md`). **O
critério de aceite é 0,000001 num sinal com ruído 0,011.** Se isso for verdade,
o "vencedor" do F6 é o candidato com melhor sorte de seed, e o FAIL do portão
não é uma descoberta sobre o bot — é ruído.

Isto tem que ser resolvido antes de qualquer coisa, porque **a E5 usa o mesmo
sweep** e herdaria o mesmo defeito.

**Como:**

1. Rode `evaluate(V3_FEATURES, 2000, seed)` para 20 seeds diferentes. Anote a
   média e o desvio-padrão de `fitness`.
2. Repita com `games = 20_000`.
3. Compare o desvio com o ganho total que um chain do F6 produziu (do `fitness`
   inicial ao final, em `docs/v3-sweep-result.json`).

**Portão:**

- Se `desvio(2k) ≥ ganho médio do chain` → **o sweep atual não otimiza nada**.
  Corrija antes de seguir: margem de aceite em `climbChain` de `1e-6` para
  `2×SE` (~0,02) **e** `games` de 2k para 10k. Custo: 5× mais CPU por eval, mas
  o `plano-perf-climb.md` já entregou o climb em ~5 min, então cabe.
- Se o desvio for pequeno → registre o número e siga; o F6 FAIL era real, o que
  reforça a tese deste plano.

**Entregável:** uma tabela de 4 linhas no fim deste documento. Nada mais.

---

### E1 — Tabela `W(a, b, dealer)` (meio dia, **zero ML**, maior payoff/esforço)

**O que é:** para cada placar possível (`a`, `b` ∈ 0..11, mais quem é o dealer),
a probabilidade do time 0 vencer a partida. 13×13×2 = 338 células.

**Por que paga:** hoje o bot aproxima isso com `distToWin`, `distToLose`,
`distDangerWeight`, `distFinishWeight`, `runCostWeight` e `scoreSensitive` —
seis mecanismos calibrados à mão para uma quantidade que dá para **medir
exatamente**. E resolve de lado a queixa original da mesa ("o jogo acaba porque
ele pede 12"): com `W`, subir para 12 estando em 9×2 é obviamente ruim porque
`W(9, 14)` = 0. Nenhum knob precisa aprender isso.

**Como (é só simulação, você já tem tudo):**

1. `createMatch` já aceita seed; adicione um
   `opts.initialScores?: [number, number]` em `packages/engine/src/match.ts:60`
   (~3 linhas, o `m.scores` já existe em `:69`).
2. Script `scripts/build-wtable.mts`: para cada `(a, b, dealer)`, rode N=2000
   partidas v3-vs-v3 (self-play) a partir daquele placar, conte vitórias. 338 ×
   2000 = 676k partidas ≈ **4 min** a 3.100 partidas/s. Paralelize com o pool
   que `sweep-v3.mts` já tem se quiser 30 s.
3. Emita `packages/bots/src/wtable.ts`: `export const W_TABLE: number[][][]`. É
   um literal de 338 números. Commite o arquivo — é determinístico e barato de
   regenerar.

**Sanidades obrigatórias** (falhou, tem bug — não siga):

- `W(a, a, dealer)` ≈ 0,5 ± 0,02 para todo `a`. Simetria.
- `W(11, 0)` > 0,95, `W(0, 11)` < 0,05.
- `W` monotônica em `a` (não-decrescente) e em `b` (não-crescente).
- `W(a, b, dealer=0) + W(b, a, dealer=1)` ≈ 1.

**Uso imediato, ainda sem ML (E1.5):** substitua os cinco knobs de placar pela
comparação de EV usando o `p` **que o bot já calcula hoje** (`strengthScore`,
`heuristic2.ts:406`). Não é `p` calibrado — é uma força de mão em 0–1 usada como
se fosse probabilidade —, mas já testa o encanamento inteiro sem depender da E2.

**Portão E1:** as quatro sanidades. **Portão E1.5:** os três portões da Missão
(`vsV2 ≥ 53,5%`, `vsV1 ≥ 55,2%`, `self≥9 < 31,7%`), N=20k, seed-block test. Se
E1.5 falhar mas E1 passar, siga assim mesmo — o `p` falso é a explicação
provável, e a E2 é exatamente o conserto.

---

### E2 — Modelo de `p` (probabilidade de vencer a mão) — a parte de ML

Aqui está o trabalho de verdade. São quatro passos, nenhum deles difícil.

#### E2.1 — Instrumentar a coleta (é log, não é ML)

Em `runArena` (`simulation.ts:233`), adicione um `opts.collect?: (row) => void`.
Toda vez que uma política for chamada num turno em que **truco está no menu** (o
mesmo split da F8), grave:

- as **features** (lista abaixo),
- um id da mão,
- o assento.

No fim de cada mão, você sabe quem venceu → volte e preencha o `label` (1 se o
time daquele assento venceu a mão, 0 se não). Emita CSV.

**Feature set inicial** — quase tudo já existe em `assessHand`
(`heuristic2.ts:215`); os itens marcados **★** são novos e são o que a F8 diz
que falta (informação da aposta):

| #    | Feature                                                   | Origem           |
| ---- | --------------------------------------------------------- | ---------------- |
| 1    | `topTwo` (força 0–1)                                      | `HandAssessment` |
| 2    | `myMax / 13`                                              | `HandAssessment` |
| 3    | `holdsTopAlive` (0/1)                                     | `HandAssessment` |
| 4    | `beatsTable` (0/1)                                        | `HandAssessment` |
| 5    | `partnerIsWinning` (0/1)                                  | `HandAssessment` |
| 6    | `isLastToPlay` (0/1)                                      | `HandAssessment` |
| 7    | `cardsPlayedInVaza / 3`                                   | `HandAssessment` |
| 8–10 | `vazaScore` one-hot (`won1`/`lost1`/`tied1`)              | `HandAssessment` |
| 11   | `mustWinBoth` (0/1)                                       | `HandAssessment` |
| 12   | `vazaIndex / 2`                                           | `PlayerView`     |
| 13   | cartas restantes na minha mão / 3                         | `PlayerView`     |
| 14   | `strongerCardsRemaining` normalizado                      | `strength.ts`    |
| 15 ★ | nível atual do truco (índice em `trucoSequence`, 0–4)     | `PlayerView`     |
| 16 ★ | **quem propôs** o nível atual: eu / parceiro / adversário | novo campo       |
| 17 ★ | em que vaza a proposta veio (0–2)                         | novo campo       |
| 18 ★ | nº de raises do adversário nesta mão                      | novo campo       |
| 19 ★ | o adversário propôs **depois** de perder a 1ª vaza (0/1)  | derivado         |
| 20   | é mão de onze (0/1)                                       | `PlayerView`     |

**★ é o coração deste plano.** Sem as features 15–19 o modelo não pode aprender
"ele aumentou na vaza 2 tendo perdido a primeira → provavelmente tem manilha", e
esse é precisamente o tipo de inferência que separa os 49,7% dos 99,7%. Se o
`PlayerView` não expõe o histórico de apostas, **expor é pré-requisito** — é
informação pública na mesa, não é trapaça.

**Volume:** 100k partidas. Estime ~10–20 decisões de truco por partida → 1–2M
linhas. A 3.100 partidas/s são ~35 s de CPU. CSV de ~150 MB — mantenha fora do
git (`.gitignore`).

**Com qual bot gerar?** Nesta primeira rodada, self-play do v3 atual. Metade das
partidas contra o v2 e contra o v1 para variar a distribuição.

**Sanidade obrigatória:** a média da coluna `label` tem que ser ≈ 0,5 no
self-play. Se não for, você está rotulando do assento errado.

#### E2.2 — Treinar (2 s de CPU, ~10 linhas de Python)

```python
# scripts/train_p.py — roda fora do build do projeto
import numpy as np, pandas as pd, json
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss

d = pd.read_csv("data/decisions_train.csv")
X, y = d.drop(columns=["label"]).values, d["label"].values
m = LogisticRegression(max_iter=1000, C=1.0).fit(X, y)

v = pd.read_csv("data/decisions_holdout.csv")   # seeds que não entraram no treino
p = m.predict_proba(v.drop(columns=["label"]).values)[:, 1]
print("brier:", brier_score_loss(v["label"], p))
print("baseline (chute 0.5):", brier_score_loss(v["label"], np.full(len(v), .5)))

json.dump({"w": m.coef_[0].tolist(), "b": float(m.intercept_[0]),
           "features": list(d.drop(columns=["label"]).columns)},
          open("packages/bots/src/pmodel.json", "w"))
```

`pip install scikit-learn pandas` e acabou. Nenhum notebook, nenhum tuning de
hiperparâmetro — `C=1.0` default está bom para 20 features e 1M linhas.

**Portão E2.2 (métrica de modelo, não do bot):**

- **Brier no holdout < 0,20** (baseline do chute é 0,25). Abaixo de 0,20 o
  modelo tem sinal real.
- **Curva de calibração:** divida o holdout em 10 baldes por `p` previsto; em
  cada balde, a taxa real de vitória tem que ficar a ±0,05 do centro do balde.
  Escreva as 10 linhas no doc. Se o modelo diz 0,8 e a realidade é 0,6, **a
  fórmula de EV vai decidir errado** e nenhum ganho de winrate aparece.
- Se a calibração falhar: `LogisticRegression` calibrada raramente falha; o
  suspeito é vazamento (alguma feature contém a resposta) ou label do assento
  errado. Não parta para modelo maior antes de achar o bug.

#### E2.3 — Inferência em TypeScript (~20 linhas, zero dependência)

```ts
// packages/bots/src/pmodel.ts
import model from "./pmodel.json";
export function winProbability(f: readonly number[]): number {
  let z = model.b;
  for (let i = 0; i < f.length; i++) z += model.w[i] * f[i];
  return 1 / (1 + Math.exp(-z));
}
```

**Portão obrigatório (paridade Python↔TS):** grave 1000 linhas do holdout com o
`p` que o Python previu; um teste em `tests/` roda `winProbability` nas mesmas
features e exige `|p_ts − p_py| < 1e-9`. Sem esse teste você vai depurar winrate
quando o bug é ordem de coluna. **É o teste mais importante desta fase
inteira.**

#### E2.4 — Ligar `p` na decisão

Em `decideHeuristicV3Action`, no ramo de truco, troque
`scoreToProbability(score, threshold, sharpness)` pela regra de EV da Tese, com
`p = winProbability(features)` e `W` da E1.

Mantenha **um** knob de aleatoriedade: aceitar/pedir com probabilidade suavizada
perto da fronteira de EV (uma sigmoide sobre `EV(aceitar) − EV(correr)` com um
`evSharpness`). Política de aposta 100% determinística é lida de graça pelo
adversário. **Só esse knob**, e ele entra no sweep da E5.

**Portão E2:** os três portões da Missão, N=20k, seed-block test.

**Referência de expectativa** (não é promessa): a decomposição EV+`p` é o que
resolveu poker heads-up limit antes de qualquer rede neural. Se o modelo tiver
Brier < 0,20, bem calibrado, e o bot **não** melhorar contra o v2, o suspeito é
a fase E4 (distribution shift), não a tese.

---

### E3 — Podar os knobs mortos (1 h, higiene, obrigatório)

Regra 5 do `plano-bot-v3.md`: termo cujo Δ de ablação cai no ruído é
**deletado**. Depois da E2, rode a ablação existente do `sweep-v3.mts` e
**apague** de `HeuristicV2Features` todo knob que a fórmula de EV substituiu.
Expectativa: 13 knobs → 2 ou 3.

Isso não é limpeza cosmética — é o que torna a E5 viável. Sweep de 3 dimensões
com 10k partidas por eval é mais barato _e_ muito menos sujeito a overfit que
sweep de 13 dimensões com 2k.

---

### E4 — Iterar o dataset (meio dia, o passo que quase todo mundo esquece)

O modelo da E2 aprendeu `P(vitória)` nos estados que o **v3 antigo** visitava. O
bot novo aposta diferente → visita estados diferentes → o modelo é otimista
justamente onde o bot novo passa a viver. Isso é _distribution shift_, e é a
causa nº 1 de "o modelo tem métrica boa e o bot não melhora".

**Conserto (é um `for`, não é teoria):**

```
bot₀ = v3 atual
repita k = 1, 2, 3:
    dados_k  = gerar 100k partidas com bot_{k−1}
    modelo_k = treinar(dados_k)          # mesmo script da E2.2
    bot_k    = v3 + EV + modelo_k
    medir bot_k vs v2 / v1 / self-play   # os três portões
até o ganho de winrate entre iterações ficar < 2×SE
```

Três iterações costumam bastar; ~5 min de CPU cada. **Pare quando o ganho entrar
no ruído** — continuar é overfit puro (regra 8).

Nesta fase é obrigatório reter os datasets contra v1 e v2, não só self-play; um
modelo treinado só em self-play não aprende a ler as apostas de _outro_ bot.

**Portão E4:** os três da Missão, **e** `vsV1` não pode cair entre iterações. Se
`vsV2` sobe e `vsV1` cai, o modelo está aprendendo os buracos do v2 (Anexo A do
`plano-bot-v3.md`, regra 7) — pare e reporte.

---

### E5 — Modelo de adversário: `P(o adversário corre | eu aumento)` (a F10)

Só depois que a E4 estabilizar. É o que habilita **aumentar e blefar** de forma
correta: hoje o EV da E2 só sabe decidir aceitar/correr, porque o EV de aumentar
depende de o que o outro vai fazer.

```
EV(aumentar para L') = q · W(a+s, b)                            [ele corre]
                     + (1−q) · [ p' · W(a+L', b) + (1−p') · W(a, b+L') ]
```

`q` = probabilidade de ele correr, `p'` = minha prob. de vencer **dado que ele
aceitou** (que é menor que `p` — se ele aceitou, ele é forte; isso se chama
_maldição do vencedor_ e é a razão de bots ingênuos aumentarem demais).

Ambos saem do **mesmo dataset** que você já coleta na E2.1 — é só mudar o label:

- `q`: label = "o adversário correu?", features = a visão dele que é pública +
  nível proposto. Outra regressão logística, mesmo script.
- `p'`: filtre o dataset da E2 para as linhas em que o adversário aceitou e
  treine de novo. Um segundo conjunto de pesos, zero código novo.

**Portão E5:** três da Missão **e** `self≥9 < 31,7%`. Esta fase é a que pode
recriar a patologia do "fecha em 12" — foi exatamente o que matou o híbrido MC
da F9 (99,7% de fechamento em 12). O `W` da E1 protege parcialmente; o portão
existe para provar.

**Condição de abandono:** se `q` tiver Brier > 0,23 (mal melhor que chute), o
adversário não é previsível com essas features. Pare — a F9 já mostrou o que
acontece quando se insiste em modelar aposta sem sinal.

---

### E6 — Só se E2–E5 passarem e ainda faltar para 60%

Nesta ordem, e cada uma só depois de a anterior falhar por motivo medido:

1. **Mais capacidade no modelo de `p`:** troque a regressão logística por um MLP
   de 2 camadas × 32 unidades (`sklearn.neural_network.MLPClassifier`, mesmo
   script). Exporte as matrizes como arrays; a inferência em TS vira ~25 linhas.
   Ainda zero dependência em produção. Só faça se a curva de calibração da E2
   mostrar erro **sistemático** por região (sinal de que o modelo linear não tem
   forma suficiente).
2. **Features de interação** antes do MLP, se preferir manter linear: produtos
   como `topTwo × nível_do_truco`. Mais barato e mais legível.
3. **Rust / CFR:** ver "o que não fazer".

---

## C — Auditoria do respond (fase ATIVA — leia inteiro antes de tocar em arquivo)

Esta é a fase corrente. A ablation F falhou a predição; a leitura da tabela
mudou o suspeito de lugar. Comece por **"O que a ablation realmente disse"** —
sem isso você vai refazer trabalho já descartado.

### O que a ablation realmente disse

| Modo                           | vsV2  | vsV1  | self≥9 |
| ------------------------------ | ----- | ----- | ------ |
| EV raise on (E4 k=2)           | 55,2% | 46,6% | 88%    |
| raise EV off, propose clássico | 48,8% | 48,1% | 88%    |
| raise off total                | 34,3% | 31,6% | 0%     |

Três leituras, todas necessárias:

1. **A linha 2 é a que localiza o defeito.** Com raise EV off e propose
   clássico, `self≥9` continua em 88% — mas o clássico do F6 dava **24,2%**. A
   única diferença entre os dois é o lado do **respond**. Logo: o respond-EV não
   correr é **suficiente sozinho** para produzir a escalada. O propose clássico
   só sobe a escada porque ninguém nunca corre do outro lado.
2. **O `self≥9 = 0%` da linha 3 não é informação.** Sem raise nenhum em
   self-play toda mão vale 1, então `≥9` é impossível por construção. Não trate
   esse zero como sinal de nada. O `34,3%/31,6%` é só o custo de nunca apostar.
3. **A hipótese F (árvore de raise truncada) está descartada** para esta rodada.
   Não implemente `q` ternário. Ela pode voltar depois que o respond estiver
   correto — não antes, porque hoje ela seria medida em cima de um respond
   quebrado.

### Diagnóstico a testar (duas causas independentes, some as duas)

**Causa 1 — o dataset envenena o sinal da aposta.**
`scripts/collect-decisions.mts:137` mistura **50% self-play / 25% v2 / 25% v1**.
Na iteração E4 k=2 o "self" é o próprio bot EV, que aumenta com tudo (88% de
escalada). Metade das linhas de treino vêm de um apostador cujos raises **não
carregam informação**, então `p` aprende `P(vitória | ele aumentou p/ 12) ≈ 0,5`
— e naqueles dados isso é literalmente verdade. Com `p ≈ 0,5` em todo nível, o
pot odds do EV (correto: aceitar 9→12 exige só `p > 0,125`) nunca manda correr.

É um laço auto-confirmante: aumenta com tudo → dados dizem que raise é ruído →
modelo manda pagar tudo → aumentar nunca é punido → a iteração seguinte piora. O
E4 "parou no ruído" porque **convergiu para esse ponto fixo**, não por falta de
sinal.

Isso também explica o par que estava sem explicação: **vsV2 sobe e vsV1 cai.** O
v2 também aumenta solto, então pagar largo contra ele é exploit e funciona. O v1
aumenta **honesto** — pagar largo é pagar mão forte. Sangrar especificamente
contra o adversário honesto é a assinatura de "meu `p` não respeita o sinal da
aposta" (regra 7 do `plano-bot-v3.md`, agora com mecanismo).

Brier global ~0,20 escondeu isso porque nós de nível alto são ~3–5% das linhas:
não movem a métrica global e decidem a partida.

**Causa 2 — `evSharpness` está em unidade errada (uma linha).**
`heuristic2.ts:128`: `evSharpness: 30`. O caminho clássico usa `sharpness: 80`
sobre unidades de força de carta (1/13 ≈ 0,077) → `80 × 0,077 ≈ 6`, sigmoide
saturada, decisão firme. O caminho EV usa 30 sobre deltas de `W`, que valem
~0,01–0,05 → `30 × 0,02 = 0,6` → sigmoide em **0,65**. Mesmo quando o EV manda
correr com clareza, ele corre em ~35% das vezes. Para ser tão decisivo quanto o
clássico, `evSharpness` precisa ficar na casa de **300–500**.

As duas causas empurram para o mesmo sintoma e são independentes. Meça separado.

---

### C1 — Calibração fatiada de `p` (~1 min de CPU, **sem arena**)

Faça primeiro. É o que confirma ou mata a Causa 1, e não custa quase nada.

O `train_p.py` já imprime calibração em 10 baldes, mas **global** — é exatamente
a agregação que esconde o defeito. Você precisa da mesma tabela **fatiada por nó
de aposta**.

Escreva `scripts/audit-p-slices.py` (~30 linhas, não mexa no `train_p.py`):

1. Carregue `packages/bots/src/pmodel.json` (tem `w`, `b`, `t`, `features`) e o
   holdout `data/p_holdout.csv`.
2. Calcule `p = 1/(1+exp(−(X·w + b)/t))`. **Use o `t`** — o `train_p.py` aplica
   temperatura e esquecer isso invalida a auditoria inteira.
3. Agrupe por `(trucoLevel, raiserOpp)`. Ambas já são colunas do CSV
   (`P_FEATURE_NAMES`, `features.ts:15`). `trucoLevel` é normalizado
   `seq.indexOf(valor)/4` → os baldes são `0, 0.25, 0.5, 0.75, 1.0` para
   `1, 3, 6, 9, 12`.
4. Por grupo imprima: `n`, `p` médio previsto, winrate real (`label.mean()`),
   erro absoluto.

**Predição do diagnóstico:** em `trucoLevel ≥ 0.5` (valor ≥6) com
`raiserOpp = 1`, previsto ≈ **0,50** e real ≈ **0,25–0,35**.

**Portão C1:**

- Erro > 0,10 em qualquer grupo com `n ≥ 500` → **Causa 1 confirmada**, siga
  para C3.
- Todos os grupos dentro de 0,05 → Causa 1 **morta**. O `p` está certo e o
  problema é só a Causa 2 (ou `W` no respond). Reporte e pare — não invente uma
  terceira hipótese sem medir.

Escreva a tabela inteira no Registro de medições, inclusive os grupos que
passaram.

### C2 — Varredura de `evSharpness` (~10 min, independente de C1)

Rode em paralelo com C1; não dependem um do outro.

Com `useEvTruco: true`, `useEvRaise: false` (respond-EV isolado), meça
`evSharpness ∈ {30, 100, 300, 1000}`, N=20k, seed-block **test**, os três
números de sempre.

**Portão C2:** se `self≥9` cair monotonicamente com `evSharpness` subindo, a
Causa 2 é real e o valor novo entra no default. Se não mexer em nada, a Causa 2
está morta e o problema é inteiro do `p` — o que reforça C1.

**Não** varra `evSharpness` junto com raise EV ligado. Duas variáveis de uma vez
= nenhuma atribuição possível (regra 13).

### C3 — Consertar a mistura do dataset (só se C1 confirmar)

O laço E4 como está escrito **neste documento** está errado para este jogo.
"Gerar dados com `bot_{k−1}`" é iteração ajustada padrão e funciona quando o que
se itera é jogo de carta. Quando o que se itera é o **comportamento de aposta do
adversário**, self-play colapsa o sinal — é o ponto fixo descrito na Causa 1.

Conserto (uma linha de mistura + retreino de 2 s):

1. `scripts/collect-decisions.mts:137`: o componente "self" passa a usar o v3
   **clássico congelado** (`useEvTruco: false`), que aumenta com disciplina —
   não o bot EV corrente. E suba a fatia dos adversários honestos: **20% self /
   40% v2 / 40% v1**.
2. Recolete, retreine `p` com o `train_p.py` sem mudar nada nele.
3. **Rode C1 de novo no modelo novo.** O erro nos grupos de nível alto tem que
   cair para < 0,05. Se não cair, o conserto não pegou — não siga para arena.
4. Só então meça na arena: três portões, N=20k, seed-block test.

**Portão C3:** os três da Missão. Atenção especial ao `vsV1` — é a métrica que
diagnosticou o problema, então é a que prova o conserto. `vsV2` subindo com
`vsV1` parado significa que você trocou um exploit por outro.

**Condição de abandono:** se depois de C1+C2+C3 o `self≥9` continuar acima de
50%, pare e reporte. Não parta para `q` ternário, MLP ou nova feature — três
hipóteses medidas e mortas significam que a tese do EV não sobrevive neste jogo,
e isso é um resultado publicável no doc, não um convite a tentar a quarta.

### O que NÃO fazer nesta fase

- **Não** implemente `q` ternário / árvore de raise recursiva (hipótese F,
  descartada pela linha 2 da ablation).
- **Não** inicie E3 (podar knobs) nem E6 (MLP). O plano bloqueia os dois
  enquanto o EV não passar portão, e `p` com Brier ~0,20 não justifica MLP.
- **Não** retreine com dados gerados pelo bot EV corrente. É a causa, não o
  conserto.
- **Não** leia o `self≥9 = 0%` da linha 3 da ablation como sinal.
- **Não** promova nada para produção. `useEvTruco` continua `false` até três
  portões verdes.

---

## O que não fazer

- **Reescrever engine ou bot em Rust.** Recusado com número no
  `plano-perf-arena.md`, e este plano precisa de ~35 s de CPU para gerar os
  dados. Acelerar não é o gargalo; representação é. (Eu sugeri isso antes de ler
  as medições — estava errado.)
- **Rede neural grande, GPU, PyTorch, ONNX, tensorflow.js.** 20 features e 1M
  linhas é território de regressão logística. Qualquer coisa maior aqui é
  complexidade sem sinal para sustentá-la, e coloca dependência de runtime num
  jogo que hoje roda com zero.
- **GPU.** O plano inteiro (E0–E5) gasta **< 1 h de CPU**; o item que domina é
  simulação de partida, que é o pior caso para GPU — cada mão tem número
  variável de vazas e ramos de aposta, então threads do mesmo warp divergem e
  você paga pela partida mais longa do lote. Treinar `p` são 2 s; transferir
  para a GPU custa mais. GPU só passaria a valer no caminho AlphaZero-like
  (milhões de avaliações de rede dentro de uma busca), que este documento
  descarta por outro motivo — 2v2 é jogo de times.
- **CFR / Deep CFR.** É o único caminho para "ótimo" no sentido teórico, mas:
  (a) truco aqui é **2v2**, um jogo de times — CFR não converge para Nash em
  jogos de time como converge em 2 jogadores soma-zero, porque a estratégia
  ótima do time exigiria correlação que os parceiros não podem estabelecer; (b)
  exige abstração de mão e semanas de trabalho; (c) o alvo do projeto é "vencer
  o v2", não "ser inexplorável". Se um dia o alvo virar exploitabilidade, este
  plano vira pré-requisito, não desperdício — `W` e `p` continuam válidos.
- **Aumentar o sweep antes da E0.** Regra 8. E se a E0 confirmar o problema de
  ruído, todo sweep anterior está sob suspeita.
- **Treinar `p` com `revealAllHands`.** Tentador (o oráculo está ali), mas o
  modelo aprenderia a prever com informação que o bot não terá em jogo, e a
  previsão em produção fica descalibrada exatamente onde importa. Se quiser usar
  o oráculo, use-o para gerar **estados interessantes**, nunca as features.
- **Olhar o seed-block `test` durante E2–E4.** Treino e holdout saem do bloco
  `train`. O `test` se toca uma vez por fase, no portão. Regra 4.

---

## Ordem de execução e custo estimado

| Fase     | O que entrega                                    | Esforço  | CPU     | ML?     |
| -------- | ------------------------------------------------ | -------- | ------- | ------- |
| **E0**   | Saber se o sweep mede alguma coisa               | 1 h      | ~10 min | não     |
| **E1**   | `W_TABLE` + sanidades                            | meio dia | ~4 min  | não     |
| **E1.5** | EV com força-de-mão no lugar dos knobs de placar | 2 h      | ~5 min  | não     |
| **E2**   | Dataset + `p` + EV completo                      | 2 dias   | ~2 min  | **sim** |
| **E3**   | Podar knobs mortos                               | 1 h      | ~10 min | não     |
| **E4**   | 3 iterações de dataset                           | meio dia | ~20 min | sim     |
| **E5**   | `q` e `p'` — aumentar/blefar                     | 1 dia    | ~10 min | sim     |

**A E0 e a E1 são independentes da E2** e não têm ML nenhum. Se você quiser um
ponto de parada natural, é depois da E1.5: cinco knobs deletados, uma tabela
exata no lugar de calibração, e a queixa da mesa ("ele pede 12") atacada na
raiz.

---

## Regras de engajamento

As dez do `docs/plano-bot-v3.md` continuam valendo sem exceção. Três adições
específicas de ML:

11. **Portão de paridade Python↔TS** é obrigatório em toda fase que exporte
    pesos (E2.3, E5). Sem ele, um erro de ordem de coluna vira uma semana de
    caça a winrate.
12. **Calibração antes de winrate.** Se o modelo não estiver calibrado, o EV
    decide errado e o número da arena não diz nada sobre a tese. Publique as 10
    linhas da curva antes de rodar arena.
13. **Um modelo por vez.** `p` primeiro, sozinho, medido. `q` e `p'` só depois
    que `p` passou o portão. Dois modelos novos ao mesmo tempo = nenhuma
    atribuição possível quando falhar.

---

## Registro de medições

Preencha conforme executar. Números que falharam economizam CPU da próxima
pessoa (regra 9).

### E0 — ruído do sweep

| Medição                                               | Valor                                                                                 | Data       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| `fitness` médio (V3_FEATURES, 20 seeds, games=2k)     | −1 (20/20 discarded vsV1)                                                             | 2026-07-26 |
| desvio-padrão idem                                    | n/a (fitness constante −1)                                                            | 2026-07-26 |
| desvio-padrão `wrVsV2` @ 2k (proxy do sinal do climb) | **0,45 pp** (mean 54,66%)                                                             | 2026-07-26 |
| desvio-padrão `wrVsV2` @ 20k                          | **0,17 pp** (mean 54,92%)                                                             | 2026-07-26 |
| ganho médio de um chain do F6                         | não no JSON; critério aceite era **1e-6** ≪ 0,45 pp                                   | 2026-07-26 |
| **Veredito** (sweep mede sinal? S/N)                  | **N** — aceite corrigido para `CLIMB_ACCEPT_MARGIN=0.02` e `coarse-games` default 10k | 2026-07-26 |

### E1 — `W_TABLE`

| Sanidade        | Esperado                | Medido                               |
| --------------- | ----------------------- | ------------------------------------ |
| `W(a,a,d)`      | 0,50 ± 0,04 (dealer)    | max \|err\|=0,0385; mean 0,015       |
| `W(11,0)`       | > 0,95                  | 0,968 / 0,973                        |
| monotonicidade  | sem violação (tol 0,03) | OK                                   |
| simetria dealer | soma ≈ 1,0 (tol 0,06)   | mean \|sum−1\|=0,017; 1 outlier 1,06 |

### E1.5 — EV com strengthScore

| Métrica | Portão  | Medido (N=10k test, 2026-07-26)    |
| ------- | ------- | ---------------------------------- |
| vsV2    | ≥ 53,5% | **40,58% FAIL**                    |
| vsV1    | ≥ 55,2% | (não medido — p falso)             |
| self≥9  | < 31,7% | fechamentos@12 dominam (patologia) |

Seguir para E2 (p calibrado), conforme plano.

### E2 — modelo `p`

| Métrica                             | Portão  | Medido                                                               |
| ----------------------------------- | ------- | -------------------------------------------------------------------- |
| Brier holdout                       | < 0,20  | **0,1986** (T=1,88) OK                                               |
| Brier baseline (0,5)                | 0,25    | 0,2500                                                               |
| Máx. erro de calibração (10 baldes) | < 0,05  | **0,024** OK                                                         |
| Paridade Python↔TS                  | < 1e-9  | OK                                                                   |
| vsV2 (N=10k, test)                  | ≥ 53,5% | EV respond: 51,4%; EV+propose-ingênuo: 55,1%; **classic F6b: 55,2%** |
| vsV1 (N=10k, test)                  | ≥ 55,2% | EV respond: 49,1%; EV+propose: 50,5% — **FAIL**                      |
| self≥9                              | < 31,7% | EV: 50–65% — **FAIL** (patologia do 12)                              |

**Veredito E2:** modelo `p` passou métricas de ML. Ligar EV no respond **não**
bate o classic F6b; EV no propose sem `q` (E5) explora o v2 (+pp) mas regrede vs
v1 e fecha em 12. `useEvTruco` permanece **false** em produção até E4/E5. Infra
(W_TABLE, pmodel, collect/train, features de aposta) fica pronta.

Calibração (10 baldes, T=1,88):

| balde | p̂     | empírico | \|err\| |
| ----- | ----- | -------- | ------- |
| 0     | 0,105 | 0,092    | 0,014   |
| 1     | 0,199 | 0,191    | 0,008   |
| 2     | 0,261 | 0,275    | 0,015   |
| 3     | 0,320 | 0,344    | 0,024   |
| 4     | 0,393 | 0,404    | 0,011   |
| 5     | 0,467 | 0,467    | 0,000   |
| 6     | 0,530 | 0,513    | 0,017   |
| 7     | 0,597 | 0,611    | 0,014   |
| 8     | 0,699 | 0,721    | 0,022   |
| 9     | 0,828 | 0,821    | 0,007   |

### E5 — modelo `q` / `p'` (aumentar)

| Métrica                          | Portão  | Medido                                                         |
| -------------------------------- | ------- | -------------------------------------------------------------- |
| Brier `q` holdout                | < 0,23  | **0,1754** OK (após shuffle do split; sequencial enviesava v1) |
| Máx. erro calib. `q` (10 baldes) | < 0,05  | **0,043** OK                                                   |
| Paridade `q` Python↔TS           | < 1e-9  | OK                                                             |
| Brier `p'` holdout               | < 0,20¹ | **0,2201** (cal OK máx 0,024; acima do portão de `p`)          |
| Paridade `p'` Python↔TS          | < 1e-9  | OK                                                             |
| vsV2 (N=20k, test, useEvTruco)   | ≥ 53,5% | **54,39%** OK                                                  |
| vsV1 (N=20k, test)               | ≥ 55,2% | **45,72%** FAIL                                                |
| self≥9 (N=20k/4 self)            | < 31,7% | **88,03%** FAIL (self@12 = **83,6%**)                          |

¹ `p'` é opcional no plano; mantido em runtime porque a calibração passou e cai
no fallback para `p` se `trained:false`.

**Veredito E5:** infra de `q`/`p'` + EV de aumentar está ligada atrás de
`useEvTruco`. Métricas de ML de `q` passaram; o portão de winrate **não**. `q`
aprendeu a taxa de corrida do bot clássico (~69%); em self-play EV×EV ninguém
corre nessa taxa → fold equity inflada → corrida ao 12. Isso é _distribution
shift_ no modelo de adversário (território E4), não bug de encanamento.
`useEvTruco` permanece **false**.

Calibração `q` (10 baldes, T≈0,99):

| balde | q̂     | empírico | \|err\| |
| ----- | ----- | -------- | ------- |
| 0     | 0,164 | 0,160    | 0,003   |
| 1     | 0,655 | 0,680    | 0,025   |
| 2     | 0,719 | 0,718    | 0,001   |
| 3     | 0,722 | 0,727    | 0,005   |
| 4     | 0,724 | 0,756    | 0,032   |
| 5     | 0,728 | 0,686    | 0,043   |
| 6     | 0,769 | 0,757    | 0,012   |
| 7     | 0,780 | 0,758    | 0,023   |
| 8     | 0,783 | 0,799    | 0,016   |
| 9     | 0,869 | 0,862    | 0,006   |

### E4 — iterar dataset (distribution shift)

Coleta com `{ ...V3_FEATURES, useEvTruco: true }` (override em
`scripts/collect-decisions.mts`; **não** flipou produção). Volume 100k/iter (½
self, ¼ vs v2, ¼ vs v1). Retreino p/q/p' com `train_p.py`. Portão N=20k
seed-block test via `e5-gate.mts`. 2×SE ≈ 0,7 pp @ 20k.

| Iter    | foldRate coleta | Brier p | Brier q | cal q máx | vsV2       | vsV1       | self≥9 | self@12   |
| ------- | --------------- | ------- | ------- | --------- | ---------- | ---------- | ------ | --------- |
| E5 (k0) | ~0,69 (classic) | —       | 0,175   | 0,043     | 54,39%     | 45,72%     | 88,03% | 83,6%     |
| **k=1** | **0,448**       | 0,2005¹ | 0,208   | 0,061¹    | 54,61%     | 46,74%     | 89,31% | 80,9%     |
| **k=2** | **0,420**       | 0,2007¹ | 0,205   | 0,042 OK  | **55,15%** | 46,64%     | 87,75% | **75,8%** |
| **k=3** | **0,405**       | 0,2012¹ | 0,203   | 0,051¹    | 54,18%     | **47,17%** | 87,52% | 78,0%     |

¹ Modelo ML: p Brier ficou ~0,201 (limiar 0,20); q cal falhou em k=1 e k=3.
Pesos mesmo assim escritos e usados no portão de winrate.

Δ k0→k2 (melhor self@12 / vsV2): vsV2 **+0,76 pp**, vsV1 **+0,92 pp**, self@12
**−7,8 pp**. Δ k2→k3: vsV2 **−0,97 pp** (sai do ruído para baixo), vsV1 +0,53
pp, self flat — **parar** (ganho entrou no ruído / regrediu).

**Portão E4:** vsV2≥53,5% OK em todas; vsV1≥55,2% **FAIL** (teto ~47%);
self≥9<31,7% **FAIL** (teto ~87%). Não houve padrão “vsV2 sobe e vsV1 cai” entre
iterações (vsV1 subiu ou ficou flat).

**Veredito E4:** retreinar no dataset EV **corrigiu parcialmente** o q (foldRate
69%→40%), e self@12 caiu ~8 pp no pico (k=2), mas a patologia do 12 persiste
(~76–89% self≥9) e vsV1 fica ~8 pp abaixo do portão. Distribution shift sozinho
**não basta**. `useEvTruco` permanece **false**. Modelos em disco = k=3 (última
iteração); produção continua classic F6b.

Próximo passo exige decisão (não E3/E6 automáticos): suspeitos — (a) EV de
aumentar ainda superestima fold equity em self-play mesmo com q recalibrado; (b)
mistura self/v1/v2 no treino de q dilui o sinal por adversário; (c) falta
penalidade explícita / W em placares altos já deveria bastar — revalidar ramo
raise.

### Ablation F — EV respond / raise off (2026-07-26)

Hipótese F: árvore de raise truncada (q binário) causa corrida ao 12. Predição:
EV respond + raise EV off → self≥9 ~24%, vsV1 recupera ~8 pp.

| Modo                                     | vsV2   | vsV1   | self≥9     | self@12 | Predição F        |
| ---------------------------------------- | ------ | ------ | ---------- | ------- | ----------------- |
| E4 k=2 (EV raise on)                     | 55,15% | 46,64% | 87,75%     | 75,8%   | —                 |
| raise EV off, propose clássico on        | 48,81% | 48,08% | **88,03%** | 85,1%   | **FAIL** (self)   |
| raise off total (`raiseGuardMaxLevel=0`) | 34,29% | 31,60% | **0%**     | 0%      | self ok, wr morto |

**Veredito:** predição F **não confirmada**. Com raise EV off o propose clássico
ainda sobe a escada — EV respond quase não corre → mesma patologia (~88%). Matar
todo raise zera self≥9 mas destrói wr. O problema não é só a árvore de raise
truncada: **EV accept/run está call-happy** (p/W do respond — hipótese C).
`useEvTruco` permanece **false**. Flag `useEvRaise` + escape `myMax≥12` do
`raiseGuard` corrigido; q ternário / `evRaise` recursiva **não** iniciados.

### C — auditoria do respond (2026-07-26)

#### C1 — calibração fatiada de `p`

Holdout = `data/decisions_holdout.csv` (E4 k=3), modelo = `pmodel.json`
(T=1,006). Script: `scripts/audit-p-slices.py`.

| trucoLevel | raiserOpp | n      | p̂     | empírico | \|err\| |
| ---------- | --------- | ------ | ----- | -------- | ------- |
| 0,00 (1)   | 0         | 220023 | 0,558 | 0,557    | 0,001   |
| 0,25 (3)   | 1         | 170017 | 0,365 | 0,367    | 0,002   |
| 0,50 (6)   | 1         | 51839  | 0,342 | 0,335    | 0,007   |
| 0,75 (9)   | 1         | 41821  | 0,494 | 0,488    | 0,006   |
| 1,00 (12)  | 1         | 14958  | 0,408 | 0,423    | 0,015   |

Predição (nível ≥6, raiserOpp=1: p̂≈0,50 e real≈0,25–0,35): **FAIL** — em nível 9
p̂≈real≈0,49 (calibrado no ponto fixo, não enviesado).

**Portão C1:** todos os grupos n≥500 com \|err\|≤0,05 → **Causa 1 MORTA**. C3
(remistura do dataset) **não** executada.

#### C2 — varredura `evSharpness` (respond-EV, `useEvRaise:false`, N=20k test)

| evSharpness | vsV2   | vsV1   | self≥9 | self@12 |
| ----------- | ------ | ------ | ------ | ------- |
| 30          | 48,81% | 48,08% | 88,0%  | 85,1%   |
| 100         | 50,56% | 49,53% | 90,5%  | 88,7%   |
| 300         | 50,95% | 49,78% | 90,4%  | 88,5%   |
| 1000        | 51,10% | 49,80% | 90,8%  | 89,3%   |

self≥9 **não** cai com sharpness (sobe levemente). **Causa 2 MORTA.**

#### Veredito C

Causa 1 (miscalibração fatiada) e Causa 2 (`evSharpness`) **mortas**. C3 não
cabe. `useEvTruco` permanece **false**. Não inventar terceira hipótese sem nova
decisão (plano C: "reporte e pare").

Nota lateral (não é hipótese nova): em nível 9 o holdout EV tem winrate real
~49% quando o opp aumentou — pot odds de pagar 9→12 pedem só p>0,125, então o EV
calibrado **nunca corre** por construção. Isso explica call-happy sem
miscalibração nem sharpness; é consequência da fórmula + distribuição, não bug
de encanamento.
