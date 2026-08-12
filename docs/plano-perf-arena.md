# Plano — acelerar a arena/sweep (medido, sem trocar de linguagem)

Status: implementado (Fix 1 + Fix 2). Fix 3 (successive halving) não feito —
opcional.

## Por que não reescrever em Rust/Go

Medido nesta máquina (Ryzen 5 5600G, 6C/12T, Node 22, `runArena` espelhado):

| Configuração                     | partidas/s |
| -------------------------------- | ---------- |
| engine puro (política aleatória) | **7705**   |
| v2 vs v2                         | 1039       |
| v3 vs v3                         | 1179       |

O engine é **14%** do tempo; o bot é **86%**. Reescrever só o engine tem teto de
1,16×. Reescrever engine + bot duplica as regras do jogo **e** o bot que está
sendo calibrado — e o que vai pra produção é o TypeScript.

Dentro do bot (21.376 `PlayerView` reais de decisão, medidos isolados):

| Trecho                               | tempo | % da decisão |
| ------------------------------------ | ----- | ------------ |
| `decideHeuristicV3Action` (completo) | 162ms | 100%         |
| └ `assessHand`                       | 138ms | 85%          |
| ..└ `strongerCardsRemaining`         | 102ms | **63%**      |
| ....└ `createDeck()` sozinho         | 7ms   | 4%           |

Uma função é 63% do custo do bot ≈ **54% de todo o tempo de sweep**. E o custo
não é o `createDeck` (4%) — é o `Set<string>` de 40 chaves `"naipe-rank"` mais o
`filter` com `getCardStrength` por carta, realocados a cada chamada.

---

## Fix 1 — `strongerCardsRemaining` aritmético (7,2× na função)

**Arquivo:** `packages/bots/src/strength.ts` **Único chamador:**
`heuristic2.ts:185` (dentro de `holdsTopAliveCard`).

### Ideia

Quantas cartas do baralho são mais fortes que a força `s` depende **só do vira**
— é tabela, não varredura. As vistas se subtraem depois:

```
resultado = tabela_do_vira[s] − (quantas cartas em `seen` têm força > s)
```

### Código atual (substituir por completo)

```ts
export function strongerCardsRemaining(
  card: Card,
  vira: Card,
  seenCards: readonly Card[],
): number {
  const seenKeys = new Set(seenCards.map(cardKey));
  const myStrength = getCardStrength(card, vira);
  return createDeck().filter(
    (c) => !seenKeys.has(cardKey(c)) && getCardStrength(c, vira) > myStrength,
  ).length;
}
```

### Código novo

Trocar o import do topo do arquivo, que hoje é:

```ts
import { RANKS, createDeck, TEAMS } from "@trucoviski/engine";
```

por:

```ts
import { RANKS, SUITS, createDeck, TEAMS } from "@trucoviski/engine";
```

E substituir a função pelas quatro declarações abaixo:

```ts
/** Id numérico único de carta (naipe*16 + rank). Máx 4*16+9 = 73. */
function cardId(card: Card): number {
  return SUITS.indexOf(card.suit) * 16 + RANKS.indexOf(card.rank);
}

/**
 * tabela[s] = quantas cartas do baralho completo são mais fortes que a força s.
 * Depende só do vira, então fica cacheada por id do vira — no máximo 40 tabelas
 * na vida do processo, e na prática 1 por mão.
 *
 * ponytail: cache global mutável, mas a função é pura em `vira` (mesma vira →
 * mesma tabela), então não há contaminação entre partidas ou entre threads.
 */
const STRONGER_TABLE: (Int8Array | undefined)[] = [];

function strongerTable(vira: Card): Int8Array {
  const key = cardId(vira);
  const cached = STRONGER_TABLE[key];
  if (cached) return cached;
  const table = new Int8Array(15); // forças 0..13, +1 de folga
  const deck = createDeck();
  for (let s = 0; s <= 14; s++) {
    let n = 0;
    for (const c of deck) if (getCardStrength(c, vira) > s) n++;
    table[s] = n;
  }
  STRONGER_TABLE[key] = table;
  return table;
}

/** Quantas cartas mais fortes que `card` ainda podem estar em jogo (não vistas). */
export function strongerCardsRemaining(
  card: Card,
  vira: Card,
  seenCards: readonly Card[],
): number {
  const myStrength = getCardStrength(card, vira);
  // Dedupe por id numérico: a versão antiga deduplicava via Set<string> e o
  // resultado precisa continuar idêntico mesmo se `seen` repetir uma carta.
  const counted = new Set<number>();
  let seenStronger = 0;
  for (const c of seenCards) {
    if (getCardStrength(c, vira) <= myStrength) continue;
    const id = cardId(c);
    if (counted.has(id)) continue;
    counted.add(id);
    seenStronger++;
  }
  return strongerTable(vira)[myStrength]! - seenStronger;
}
```

**Não** apagar `cardKey` — `montecarlo.ts:186` ainda usa.

**Não** mexer em `assessHand` para tornar `holdsTopAlive` preguiçoso. Depois
deste fix a função cai pra ~9% do custo e a preguiça deixa de valer a
complexidade.

### Teste (novo, em `tests/heuristic2.test.ts` ou arquivo próprio)

O oráculo é a implementação antiga, escrita inline no teste:

```ts
import { createDeck, RANKS, SUITS } from "@trucoviski/engine";
import type { Card } from "@trucoviski/engine";
import {
  getCardStrength,
  strongerCardsRemaining,
} from "../packages/bots/src/strength.js";

function reference(card: Card, vira: Card, seen: readonly Card[]): number {
  const key = (c: Card) => `${c.suit}-${c.rank}`;
  const seenKeys = new Set(seen.map(key));
  const s = getCardStrength(card, vira);
  return createDeck().filter(
    (c) => !seenKeys.has(key(c)) && getCardStrength(c, vira) > s,
  ).length;
}

it("strongerCardsRemaining bate a varredura de baralho em todo o espaço", () => {
  const deck = createDeck();
  for (const vira of deck) {
    for (const card of deck) {
      for (const seen of [[], [vira], [vira, card], deck.slice(0, 7)]) {
        expect(strongerCardsRemaining(card, vira, seen)).toBe(
          reference(card, vira, seen),
        );
      }
    }
  }
});
```

Isso cobre 40×40×4 = 6400 casos e não depende de nada mais.

### Ganho esperado

Medido na função: **95ms → 13ms (7,2×)**, com resultado idêntico em 3940 views
reais. Propagando: bot ~2,2× mais rápido, arena ~**1,9×** (o engine, que é 14%,
não muda).

---

## Fix 2 — paralelizar o sweep (~6-8× em 6 núcleos)

`scripts/sweep-v3.mts` roda 200 candidatos independentes num único core. A
função `evaluate` é pura e CPU-bound: entra `{features, games, seed}`, sai um
`CandidateResult`. É o caso perfeito pra pool de processos.

### Passo 2.1 — extrair `evaluate` para um módulo compartilhado

Criar `scripts/sweep-eval.mts` e **mover para lá, sem alterar nada**, estes
trechos de `sweep-v3.mts`:

- `interface CandidateResult` (exportar)
- `makeV3Policy`, `makeV2Policy`, `makeV1Policy`
- `evaluate` (exportar)

Em `sweep-v3.mts`, apagar essas definições e importar:

```ts
import { evaluate } from "./sweep-eval.mts";
import type { CandidateResult } from "./sweep-eval.mts";
```

Portão: rodar
`pnpm sweep:v3 --coarse 2 --climb-top 1 --confirm-top 1 --confirm-games 500 --skip-ablation true`
e conferir que termina sem erro. Nenhum número muda ainda.

### Passo 2.2 — o worker

Criar `scripts/sweep-worker.mts`:

```ts
#!/usr/bin/env node
/* Worker do sweep: recebe {features, games, seed}, devolve CandidateResult. */
import { evaluate } from "./sweep-eval.mts";
import type { HeuristicV2Features } from "../packages/bots/src/index.js";

interface Task {
  id: number;
  features: HeuristicV2Features;
  games: number;
  seed: number;
}

process.on("message", (task: Task) => {
  const result = evaluate(task.features, task.games, task.seed);
  process.send!({ id: task.id, result });
});
```

### Passo 2.3 — o pool

Adicionar em `sweep-v3.mts` (topo do arquivo):

```ts
import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("./sweep-worker.mts", import.meta.url));
const POOL_SIZE = Math.max(1, Math.min(cpus().length - 2, 10));

/**
 * Avalia `jobs` em paralelo e devolve os resultados NA MESMA ORDEM da entrada.
 * A ordem importa: o sweep desempata por posição e precisa ser determinístico.
 */
function evaluateAll(
  jobs: { features: HeuristicV2Features; games: number; seed: number }[],
): Promise<CandidateResult[]> {
  return new Promise((resolve, reject) => {
    const results: CandidateResult[] = new Array(jobs.length);
    let next = 0;
    let done = 0;
    const workers: ChildProcess[] = [];

    const shutdown = () => workers.forEach((w) => w.kill());

    const feed = (w: ChildProcess) => {
      if (next >= jobs.length) return;
      const id = next++;
      w.send({ id, ...jobs[id]! });
    };

    for (let i = 0; i < Math.min(POOL_SIZE, jobs.length); i++) {
      const w = fork(WORKER, [], { execArgv: ["--import", "tsx"] });
      workers.push(w);
      w.on("message", (msg: { id: number; result: CandidateResult }) => {
        results[msg.id] = msg.result;
        done++;
        if (done === jobs.length) {
          shutdown();
          resolve(results);
        } else {
          feed(w);
        }
      });
      w.on("error", (e) => {
        shutdown();
        reject(e);
      });
      feed(w);
    }
  });
}
```

### Passo 2.4 — usar o pool nos três laços

O script vira `async` — envolver o corpo em `async function main() { ... }` e
chamar `void main();` no fim, ou usar top-level `await` (o projeto é ESM, então
funciona direto).

**Coarse** — substituir o `for` de 200 iterações por:

```ts
const candidates = Array.from({ length: coarseN }, () => ({
  features: randomFeatures(rng),
  games: coarseGames,
  seed: TRAIN_SEED,
}));
const coarse = await evaluateAll(candidates);
```

Atenção: `randomFeatures(rng)` tem que ser chamado **sequencialmente na
construção do array** (como acima) pra que a sequência do PRNG não mude — é o
que mantém o sweep reproduzível.

**Hill climb** — cada cadeia é sequencial, mas as 10 cadeias são independentes.
Rodar as 10 em paralelo com 1 worker cada é mais complicado do que vale. Fazer o
mais simples: dentro de cada passo do climb, os vizinhos de uma coordenada (`-1`
e `+1`) são independentes → avaliar os dois de uma vez:

```ts
const neighbours = [
  neighbor(current.features, key, -1),
  neighbor(current.features, key, 1),
].filter((f): f is HeuristicV2Features => f !== null);
if (neighbours.length > 0) {
  evals += neighbours.length;
  const evs = await evaluateAll(
    neighbours.map((f) => ({
      features: f,
      games: coarseGames,
      seed: TRAIN_SEED,
    })),
  );
  for (const ev of evs) if (ev.fitness > current.fitness + 1e-6) current = ev;
}
```

Ganho menor aqui (2 por vez), mas é o que preserva a semântica da subida. O
grosso do tempo está no coarse e na ablação.

**Confirm e ablação** — totalmente paralelos:

```ts
const confirmed = await evaluateAll(
  toConfirm.map((c) => ({
    features: c.features,
    games: confirmGames,
    seed: TEST_SEED,
  })),
);

const ablationResults = await evaluateAll(
  FLAG_KEYS.map((flag) => ({
    features: { ...winner.features, [flag]: false },
    games: confirmGames,
    seed: TEST_SEED,
  })),
);
```

### Portão do Fix 2

Rodar duas vezes com a mesma seed e conferir que `docs/v3-sweep-result.json` sai
**idêntico** (`diff`). Se não sair, algo depende de ordem de execução e o
paralelismo está errado — provavelmente `randomFeatures` sendo chamado dentro do
laço paralelo em vez de na construção do array.

---

## Fix 3 (opcional) — successive halving no coarse

Hoje: 200 candidatos × 2000 partidas, uniforme. Com N=2000 o erro padrão é
~1,1pp, e os top-5 confirmados ficaram todos dentro de 0,4pp uns dos outros — a
maior parte desse CPU compra ruído, não sinal.

Mesmo orçamento, seleção melhor:

```ts
let pool = Array.from({ length: 400 }, () => randomFeatures(rng));
for (const [keep, games] of [
  [100, 500],
  [25, 2000],
  [10, 8000],
] as const) {
  const evs = await evaluateAll(
    pool.map((f) => ({ features: f, games, seed: TRAIN_SEED })),
  );
  evs.sort((a, b) => b.fitness - a.fitness);
  pool = evs.slice(0, keep).map((e) => e.features);
}
```

400×500 + 100×2000 + 25×8000 = 600k partidas, contra 400k do esquema atual, mas
com o dobro de candidatos explorados e o top-10 medido com 4× mais precisão.

---

## Resultado esperado

| Etapa          | tempo do sweep completo             |
| -------------- | ----------------------------------- |
| hoje           | 49 min (`elapsedSec: 2950` no JSON) |
| + Fix 1 (1,9×) | ~26 min                             |
| + Fix 2 (~7×)  | **~4 min**                          |

## Portões finais (rodar os três, nesta ordem)

```bash
# 1. arena sem viés — 2 testes passando
npx vitest run tests/arena-null.test.ts --coverage.enabled=false

# 2. bot inalterado — 18 testes passando
npx vitest run tests/heuristic2.test.ts tests/heuristic3.test.ts --coverage.enabled=false

# 3. número de referência: v3 vs v2 tem que dar 52,51%
pnpm arena --a heuristic-v3 --b heuristic-v2 --games 20000 --seed 1000003
```

Se o passo 3 não reproduzir 52,51% (±0,1pp — é determinístico, deveria bater
exato), o Fix 1 mudou comportamento e não só velocidade. O suspeito é o dedupe
dentro de `strongerCardsRemaining`.

> Se `scripts/arena.mts` ainda não tiver a política `heuristic-v3` nem a flag
> `--mirrored`, usar o script de medição direto com
> `runArena({ mirrored: true })` — o valor 52,51% foi medido com
> `mirrored: true`, `seed: 1000003`, `games: 20000` (= 40.000 partidas), v3 em
> `policyTeam0`.
