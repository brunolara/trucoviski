# Plano — Separar as fases de resolução (vaza / mão / partida)

Status: implementado.

## Problema

Quando alguém ganha a vaza ou o ponto, o jogo já recomeça — não dá pra ver qual
carta decidiu.

## Diagnóstico (raiz)

Três causas, todas no mesmo lugar: a view nova é aplicada **antes** do hold.

1. `apps/web/src/store.ts:359` — `drainQueue` faz `applySnapshot(snap)` e só
   depois segura o banner. A view nova já vem com `currentVaza = null`
   (`packages/engine/src/match.ts:395`) e, no fim da mão, com uma mão nova
   inteira. As cartas somem no mesmo frame em que o banner aparece: o hold
   segura só texto sobre um tabuleiro vazio.
2. `apps/server/src/room.ts:470` — o servidor manda **um** snapshot com
   `[cardPlayed, vazaCompleted, handFinished]` juntos. A 4ª carta, justamente a
   que decidiu, nunca tem um frame só dela.
3. `apps/web/src/store.ts:346` — em `matchFinished`, `screen: "end"` troca de
   tela antes do hold. A jogada final nunca é vista.

## Solução

Fases de apresentação no cliente. Sem mudança no engine e sem mudança no
protocolo: o evento `vazaCompleted` já carrega `plays`, `covered` e `winner` — é
tudo que a mesa precisa pra congelar o tabuleiro.

### Fases

| fase     | mesa mostra                                                        | banner            | hold   |
| -------- | ------------------------------------------------------------------ | ----------------- | ------ |
| `play`   | `view.currentVaza` (comportamento atual)                           | —                 | 0      |
| `reveal` | as 4 cartas do `vazaCompleted`, sem destaque                       | —                 | 600ms  |
| `vaza`   | mesmas cartas, carta vencedora destacada, avatar do vencedor ativo | "X venceu a vaza" | 1600ms |
| `sweep`  | cartas deslizando para o assento do vencedor                       | (mantém)          | 300ms  |
| `mao`    | resultado da mão, placar animando                                  | "+N tentos"       | 2200ms |
| `fim`    | só então troca para a tela `End`                                   | —                 | —      |

Toda fase com hold é **pulável por toque** (ver abaixo).

## Mudanças

### 1. `apps/web/src/store.ts` — estado de congelamento

Novo campo no state:

```ts
tableHold: {
  plays: readonly (Card | null)[];
  covered: readonly boolean[];
  winner?: Seat | null;   // undefined durante `reveal`; definido em `vaza`
  sweeping?: boolean;     // true na fase `sweep`
} | null;
```

Constantes de fase junto de `HOLD_MS`:

```ts
const REVEAL_MS = 600;
const VAZA_MS = 1600;
const SWEEP_MS = 300;
const HAND_MS = 2200;
```

### 2. `apps/web/src/store.ts:353` — `drainQueue` vira sequência de beats

Hoje: `applySnapshot` → `sleep(hold)` → limpa banner. Passa a ser, quando o
snapshot contém `vazaCompleted`:

```ts
applySnapshot(snap);                                    // view nova já entra
set({ tableHold: { plays, covered }, banner: null });    // reveal
await hold(REVEAL_MS);
set({ tableHold: { plays, covered, winner }, banner: bannerForEvents(...) });
await hold(VAZA_MS);
set({ tableHold: { plays, covered, winner, sweeping: true } });
await hold(SWEEP_MS);
if (handFinished) { set({ banner: bannerDaMao }); await hold(HAND_MS); }
set({ tableHold: null, banner: null });
```

Snapshots sem `vazaCompleted` seguem o caminho atual (`holdForEvents`).

### 3. `apps/web/src/store.ts` — hold pulável

`sleep` vira `hold`, com o resolve exposto num closure:

```ts
let skipHold: (() => void) | null = null;

function hold(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      skipHold = null;
      resolve();
    };
    const t = setTimeout(done, ms);
    skipHold = done;
  });
}
```

Nova action `skipPresentation()` chama `skipHold?.()`. `goToHome`/`reset` também
chamam, para não deixar timer pendurado.

### 4. `apps/web/src/screens/Mesa.tsx:282` — renderizar o congelamento

- `const table = tableHold ?? view.currentVaza` no bloco das cartas jogadas.
- Carta do `tableHold.winner`: classe de destaque (escala + borda na cor do
  time), demais cartas esmaecidas.
- `tableHold.sweeping`: `animate` do framer-motion desloca cada carta para o
  offset do assento **relativo** do vencedor (mesma tabela de 4 posições já
  usada em `SEAT_POSITIONS`), com `opacity: 0` e `scale: 0.6`.
- `onPointerDown` no `styles.screen` chama `skipPresentation()` quando
  `tableHold` ou `banner` estiver ativo. Dica visual discreta ("toque para
  pular") junto ao banner.

### 5. `apps/web/src/store.ts:346` — adiar o fim

`screen: "end"` e `clearSession()` passam a rodar **depois** do último hold do
snapshot, não durante `applySnapshot`. Mesma raiz do bug da vaza.

### 6. `apps/server/src/room.ts:27` — alinhar o ritmo dos bots

`BOT_DELAY_AFTER_VAZA_OR_HAND_MS`: 2000 → 2600 (= 600 + 1600 + 300 + folga). Sem
isso o cliente atrasa ~0,6s por vaza e o lag acumula ao longo da mão.

O hold extra de fim de mão (2200ms) não precisa de folga no servidor: durante o
jogo normal o cliente segura 600ms por carta contra 1000ms de `BOT_DELAY_MS`,
então recupera o atraso sozinho na mão seguinte.

## Verificação

- Teste unitário (`tests/`) sobre a expansão dos beats: `tableHold` é setado,
  `winner` só aparece no segundo beat, `sweeping` só no terceiro, tudo limpo no
  fim; e `skipPresentation()` encurta a sequência.
- E2E: afirmar que a carta vencedora continua no DOM enquanto
  `presentation-banner` está visível. Hoje esse teste falha — é exatamente o
  bug.
- E2E: `screen: end` só aparece depois do banner final.

## Decisões

- Sem mudança em `packages/engine`.
- Sem mudança no protocolo de `packages/shared`.
- Uma única mudança no servidor: a constante de delay dos bots.
- Sem dependências novas (framer-motion já está no projeto).
- Congelamento vale para todas as vazas, não só as do humano.
