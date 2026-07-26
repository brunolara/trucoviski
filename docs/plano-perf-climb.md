# Plano — acelerar o hill climb do sweep v3

Status: **implementado (Passo 0 + Fix 1 + Fix 2 + Fix 3).** Fixes 4–6 deixados
de lado: o plano manda parar se o Fix 1 já colocar o sweep na faixa do café; 4/5
trocam precisão por tempo. Complementa `docs/plano-perf-arena.md` e serve a F6
de `docs/plano-bot-v3.md`.

Queixa: o hill climb ainda leva ~30 min na máquina do usuário. Medido aqui:
**~13 min** (12 threads livres, `--climb-top 10`). A diferença é carga da
máquina — o diagnóstico e os fixes não dependem de qual dos dois número é o seu.

---

## Medições (Ryzen 5 5600G, 6 núcleos físicos / 12 lógicos, `POOL_SIZE = 10`)

| Medição                                                     | Valor                                        |
| ----------------------------------------------------------- | -------------------------------------------- |
| `evaluate(features, games=2000, seed)` — 1 processo, quente | **2,90s**                                    |
| └ arena vs v2 (4.000 partidas)                              | 1,49s (52%)                                  |
| └ arena vs v1 (4.000 partidas)                              | 1,00s (34%)                                  |
| └ arena self-play (1.000 partidas)                          | 0,34s (12%)                                  |
| Primeira `evaluate` num worker recém-forkado (fria)         | 3,02s                                        |
| `fork` + boot do tsx de um worker                           | 180ms                                        |
| Coarse, 40 candidatos, pool=10                              | 30–34s → **1,33 eval/s**                     |
| Um chain do climb (35–40 evals, largura 2)                  | **~78s** (média de 3 chains)                 |
| Climb inteiro, `--climb-top 10` (10 chains em série)        | **~13 min**                                  |
| Utilização do pool durante o climb                          | **1,38 worker de 10** (325s CPU / 235s wall) |
| Candidatos descartados na coarse pela restrição vs v1       | **30 de 40 (75%)**                           |

Reprodução (dois probes, 106s e 4m30s):

```bash
npx tsx scripts/sweep-v3.mts --coarse 40 --climb-top 1 \
  --confirm-top 1 --confirm-games 500 --skip-ablation true --out /tmp/probe.json
npx tsx scripts/sweep-v3.mts --coarse 40 --climb-top 3 \
  --confirm-top 1 --confirm-games 500 --skip-ablation true --out /tmp/probe3.json
```

O segundo: 270s totais − 34s de coarse = 235s para 112 evals em 3 chains → 78s
por chain, 2,1s por eval de wall. Multiplique por `climb-top` para o climb
inteiro; a escala é linear porque os chains são sequenciais.

### O que essas medições eliminam

- **Não é JIT frio.** Eval fria num worker novo: 3,02s contra 2,90s quente
  (+4%). Warmup do worker não é onde está o tempo.
- **Não é fork.** 180ms por worker; a coarse forka 10 e a ablação 6. Só passa a
  importar por causa do Fix 1 (o climb forka ~400 vezes), e o Fix 1 resolve isso
  de lado.
- **Não é a arena.** `plano-perf-arena.md` já fez a parte de 7,2× em
  `strongerCardsRemaining`. 2,90s para 9.000 partidas = ~3.100 partidas/s, é o
  que o bot em TypeScript dá.

---

## Diagnóstico — três desperdícios, todos medidos

### 1. O climb usa 2 workers de 10 (o grande)

`sweep-v3.mts:264-325`. O laço externo é
`for (let i = 0; i < seeds.length; i++)` com `await` dentro: **os 10 chains
rodam em série**. Dentro de cada chain, o paralelismo é os dois vizinhos de uma
coordenada — `evaluateAll` com 2 jobs, que forka `min(POOL_SIZE, 2) = 2`
workers, usa, e mata (`:92`).

Consequência aritmética: 10 chains × ~38 evals × 2,90s ≈ **1.100s de CPU**
rodando com largura 2 → ~13 min de wall. Medido no probe de 3 chains: 325s de
CPU em 235s de wall = **1,38 worker ocupado de 10**. Oito e meio dos dez ficam
parados durante a fase mais longa do sweep, enquanto a coarse (200 jobs
independentes) usa os dez.

**Os chains são independentes** — cada um parte de um candidato diferente e
nunca lê o resultado do outro. Não há razão para serem sequenciais.

### 2. Três de quatro candidatos morrem na restrição, e pagam as três arenas antes

`sweep-eval.mts:67-110`. A ordem é: arena vs v2 (1,49s) → arena vs v1 (1,00s) →
self-play (0,34s) → **só então** o teste da restrição
(`vsV1.winRateTeam0 < V2_VS_V1_BASELINE - tol`) descarta o candidato.

Medido: **75% dos candidatos da coarse são descartados**. Cada um deles gastou
2,90s para produzir um `fitness = -1`, quando 1,00s (a arena vs v1, a única que
a restrição lê) bastava.

### 3. Pool de 10 processos em 6 núcleos físicos

`sweep-v3.mts:22`: `POOL_SIZE = min(cpus().length - 2, 10)` = 10 nesta máquina —
mas `cpus()` conta threads SMT, não núcleos. Medido: eval isolada 2,90s (0,34
eval/s); pool de 10 entrega 1,33 eval/s = **3,9× de escala com 10 workers**. O
pool está oversubscrito e cada worker roda a ~40% da velocidade isolada.

---

## Fixes, em ordem de payoff medido

### Fix 1 — um chain por worker (o único que importa muito)

**Ideia:** o chain inteiro é uma função pura de
`(features inicial, games, seed)`. Mova o chain **para dentro do worker** e
submeta 10 chain-jobs ao pool. Cada chain roda os seus 40 evals localmente, sem
IPC por eval, e o pool fica cheio.

Não tente paralelizar _dentro_ do chain com o pool atual: o chain é
intrinsecamente sequencial (cada passo parte do ponto aceito no anterior) e o
ganho está em rodar os 10 ao mesmo tempo.

1. Extrair de `sweep-v3.mts:264-325` uma função para um módulo compartilhado
   (`scripts/sweep-climb.mts`, ou dentro de `sweep-eval.mts` — ele já é o módulo
   que o worker importa):

   ```ts
   export function climbChain(
     start: CandidateResult,
     games: number,
     seed: number,
   ): { result: CandidateResult; evals: number };
   ```

   O corpo é o que já existe, com `await evaluateAll([...])` trocado por
   `evaluate(...)` direto (dentro do worker é síncrono, e é o que já acontece no
   caminho de job único, `sweep-v3.mts:71-74`).

2. `sweep-worker.mts` passa a aceitar dois tipos de tarefa. Discriminante no
   `type` da mensagem — `{ kind: "eval" }` e `{ kind: "climb" }`, ~6 linhas.

3. `sweep-v3.mts` troca o laço dos 10 chains por uma submissão só:

   ```ts
   const climbed = await climbAll(
     seeds.map((s) => ({
       kind: "climb",
       start: s,
       games: coarseGames,
       seed: TRAIN_SEED,
     })),
   );
   ```

   `evaluateAll` já faz fila + ordem estável + tratamento de erro; generalize o
   tipo do job em vez de escrever um segundo pool.

**Ganho esperado:** o wall passa a ser o do chain mais longo sob contenção, não
a soma dos dez. Pela vazão medida do pool (1,33 eval/s a pool=10): ~380 evals ÷
1,33 ≈ **5 min**, contra 13. Não são os 78s de um chain isolado — dez chains
disputando 6 núcleos físicos rodam cada um ~4× mais devagar; é o Fix 3 que ataca
essa parte. Os ~400 forks viram 10.

**Custo:** ~40 linhas movidas, ~15 novas. Nenhuma mudança de semântica: cada
chain percorre exatamente as mesmas coordenadas na mesma ordem com as mesmas
seeds.

### Fix 2 — restrição primeiro, curto-circuito depois

`sweep-eval.mts:67`. Rodar a arena vs v1 **antes** da arena vs v2 e devolver o
descarte sem rodar as outras duas.

```ts
// A restrição só lê vsV1. Rodar as outras arenas antes é gastar 1,9s para
// jogar fora. 75% dos candidatos da coarse morrem aqui.
const vsV1 = runArena({ games, seed: seed + 10_000, ... });
const tol = games >= 20_000 ? 0.005 : 0.02;
if (vsV1.winRateTeam0 < V2_VS_V1_BASELINE - tol && games < 20_000) {
  return { features, fitness: -1, wrVsV2: NaN, wrVsV1: vsV1.winRateTeam0,
           selfPlayBigRate: NaN, selfPlay12Rate: NaN, discarded: true, games };
}
```

O `&& games < 20_000` mantém o curto-circuito **fora** do confirm e da ablação,
que são as fases que imprimem `vsV2` e `self≥9` de candidatos descartados
(`sweep-v3.mts:344-348`, `:422-427`). Assim nenhuma tabela reportada perde
número e nenhum `NaN` chega a log. Sem essa guarda, o `NaN` aparece na tabela de
ablação e você perde a informação exatamente onde ela vale.

**Ganho esperado:** −65% no custo de cada candidato descartado. Na coarse (75%
de descarte, medido) o wall cai ~49%: 30s → ~15s por 40 candidatos. No climb, o
ganho depende da taxa de descarte entre **vizinhos de um ponto viável**, que
ninguém mediu — instrumente antes de prometer (ver Passo 0).

### Fix 3 — dimensionar o pool pelos núcleos reais

`sweep-v3.mts:22`. Não chute: rode a mesma coarse de 40 candidatos com
`POOL_SIZE` ∈ {4, 6, 8, 10, 12} e escolha pelo tempo. Ponto de partida da
tabela: pool=10 → 30s.

Deixe como flag (`--pool`) com default no melhor medido, porque o número é da
máquina, não do código. Se 6 ganhar de 10, o Fix 1 herda o ganho inteiro (a
contenção de 2,6× cai).

**Ganho esperado:** 10–30% em todas as fases. É meia hora de medição e uma linha
de código.

### Fix 4 — arena de restrição mais barata dentro do climb

A arena vs v1 existe para testar uma **restrição** com `tol = 0.02` — 2pp de
folga. Rodá-la com o mesmo `games` da arena objetivo é precisão que ninguém usa:
a `SE` a 2k seeds é 1,1pp, e a metade disso (1,6pp a 1k) continua dentro da
tolerância.

Passar `games / 2` na arena vs v1 durante coarse/climb (mantendo `games` cheio
no confirm, onde o número é reportado e a `tol` é 0,005) tira ~17% do eval.

Cuidado, e é por isso que este fix vem depois do Fix 2: reduzir a precisão da
restrição **aumenta** a taxa de descarte por ruído. Meça a taxa antes e depois;
se subir muito, o Fix 4 se paga em falso.

### Fix 5 — encurtar o chain (o que sobra depois do Fix 1)

Depois do Fix 1 o caminho crítico é **um chain: 40 evals estritamente
sequenciais**. Paralelismo está esgotado; só resta menos evals ou evals mais
baratas. Duas medições decidem, nenhuma delas é palpite:

1. **O segundo passo (meio-passo, `sweep-v3.mts:290-317`) paga?** São até 18 dos
   40 evals. Registre o fitness ao fim do passo 1 e ao fim do passo 2 nos 10
   chains. Se o ganho médio do passo 2 ficar abaixo de ~0,002 (metade do `SE` do
   fitness a 2k), **delete o passo** — chain cai de 40 para 22 evals, wall cai
   45%.
2. **Quais knobs nunca se movem?** Conte, nos 10 chains, quantas vezes cada
   coordenada foi aceita. Knob com 0 aceitação em 10 chains é eval jogada fora
   em todo chain futuro; tire-o da ordem de visita (não da `KNOB_RANGES` — o
   coarse continua sorteando).

Com os dois: ~20 evals por chain em vez de ~38 — metade do caminho crítico.

### Fix 6 (opcional, só se `climb-top` cair) — subida mais íngreme

Se depois do Fix 5 você rodar poucos chains (3–4) num pool de 6, sobram núcleos.
Aí vale avaliar **todos** os vizinhos de coordenada de uma vez e mover para o
melhor (steepest ascent) em vez de aceitar o primeiro que melhora: mesmo número
de evals por passo, menos passos, e a largura extra é grátis porque os núcleos
estavam parados. Com 10 chains isso só rouba CPU dos vizinhos — **não faça com
`climb-top 10`**.

---

## Passo 0 — antes de qualquer fix (30 min, obrigatório)

O script hoje só cronometra a coarse (`sweep-v3.mts:253`). Sem timing por fase
você não sabe qual fix pagou.

1. Log de wall time por fase (coarse / climb / confirm / ablação) e no fim uma
   linha `evals=N wall=Xs cpu=Ys utilização=Y/(X×pool)`.
2. Contador de descartes **por fase** — a taxa da coarse (75%) é medida, a do
   climb não.
3. **Baseline gravado:** rode o sweep inteiro atual com uma seed fixa e guarde o
   JSON (`--out docs/v3-sweep-baseline.json`, fora do git se preferir). É o
   oráculo do portão de determinismo abaixo.

---

## Portão de determinismo (o único jeito de saber que você não quebrou o sweep)

Regra de `plano-perf-arena.md` que continua valendo: **mesma seed, mesmo
resultado.** Depois de cada fix:

```bash
npx tsx scripts/sweep-v3.mts --seed 7 --out /tmp/after.json
node -e 'const a=require("/tmp/baseline.json"),b=require("/tmp/after.json");
  const k=x=>JSON.stringify(x.winner.features)+JSON.stringify(x.confirmed.map(c=>c.features));
  console.log(k(a)===k(b) ? "IDENTICO" : "DIVERGIU")'
```

- **Fixes 1 e 3 devem dar `IDENTICO`.** São escalonamento, não semântica. Se
  divergir, algo virou dependente da ordem de execução — o suspeito é
  `randomFeatures(rng)` sendo chamado dentro de um laço paralelo em vez de na
  construção do array (`sweep-v3.mts:234-238`).
- **Fixes 2, 4 e 5 mudam números de propósito** (campos `NaN` em descartados,
  precisão da restrição, coordenadas visitadas). Aqui o portão é outro: o
  vencedor tem que passar os mesmos gates da F6 (`vsV2 ≥ 53,5%`, `vsV1 ≥ 55,2%`,
  `self≥9 < 31,7%`) e o `fitness` do vencedor não pode cair mais que 0,004.

Comparar `elapsedSec` entre as duas execuções é o número que você foi buscar.

---

## Resultado esperado

Base medida: climb ~13 min, sweep completo ~18 min (coarse 200 ≈ 170s + climb
780s + confirm/ablação ≈ 120s). As projeções abaixo saem da vazão medida do
pool, não de palpite — mas são projeções, e o Passo 0 existe para conferir cada
linha.

| Etapa                          | wall do climb | wall do sweep completo |
| ------------------------------ | ------------- | ---------------------- |
| hoje (medido)                  | ~13 min       | ~18 min                |
| + Fix 1 (chains em paralelo)   | **~5 min**    | ~10 min                |
| + Fix 3 (pool certo)           | ~4 min        | ~8 min                 |
| + Fix 2 (curto-circuito)       | ~3,3 min      | ~5,5 min               |
| + Fix 4 e 5 (eval/chain menor) | **~1,6 min**  | ~4 min                 |

Se o Fix 1 sozinho já colocar o sweep na faixa de "roda no intervalo do café",
**pare aí** — os fixes 4 e 5 trocam precisão por tempo e só valem se você for
rodar o sweep muitas vezes.

## O que não fazer

- **Reescrever em Rust/Go.** Já medido e recusado em `plano-perf-arena.md`: o
  engine é 14% do tempo, o bot é 86%, e o que vai para produção é o TypeScript.
- **Worker threads no lugar de `fork`.** O gargalo não é IPC nem boot (180ms por
  worker, 10 workers). Trocar de mecanismo de paralelismo é reescrever o pool
  para ganhar nada.
- **Cache de `evaluate`.** Dentro de um chain cada coordenada é visitada uma
  vez; não há repetição para cachear. Entre chains haveria, mas eles vivem em
  processos diferentes e compartilhar cache custa mais que o hit.
- **Successive halving no climb.** Matar metade dos chains no meio economiza
  CPU, não wall — com os chains em paralelo (Fix 1) o wall é o do chain mais
  longo, e matar chains não o encurta. (No coarse é diferente; está proposto
  como Fix 3 em `plano-perf-arena.md` e continua de pé.)
- **Aumentar `coarse-games` "porque agora dá tempo".** Regra 8 de
  `plano-bot-v3.md`: mais CPU no mesmo espaço compra overfit. O tempo
  economizado aqui é para _rodar o sweep de novo depois de mudar o bot_, não
  para varrer mais fundo.
