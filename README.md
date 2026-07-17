# Truco Online 2D

Monorepo do Truco Paulista online. **F1 + F2 slice 1 + F3 implementados.**

## Requisitos

- Node.js 22.23.1
- pnpm 11
- Docker com Compose (opcional, `pnpm validate:compose`)

## Setup

```sh
corepack enable
pnpm install
pnpm gate
```

## Scripts

- `pnpm gate`: format check, lint, tipos, testes (com cobertura ≥95%), build.
- `pnpm format`: aplica Prettier.
- `pnpm sim -- --games N`: simulação de N jogos aleatórios com políticas legais
  (default 1000).
- `pnpm validate:compose`: valida `compose.yaml`; requer Docker Compose.
- `cd apps/web && pnpm dev`: frontend Vite em http://localhost:5173.
- `cd apps/server && pnpm dev`: servidor Colyseus em ws://localhost:2568.

## Estrutura

```
packages/engine/     – Engine TypeScript puro (F1 completa)
  src/
    types.ts         – Tipos fundamentais (Card, Seat, Action, eventos, etc.)
    prng.ts          – PRNG mulberry32 + Fisher-Yates (determinístico)
    deck.ts          – Baralho francês de 40 cartas
    ranking.ts       – Ordenação de cartas, manilhas, resolução de vaza
    hand.ts          – Auxiliares de mão (deal, vaza, fase)
    match.ts         – Orquestrador da partida (API pública Match)
    simulation.ts    – Simulação de jogos aleatórios para diagnóstico
    rulesets/
      paulista.ts    – RuleSet paulista 1.0.0
packages/shared/     – Contrato wire + validação Zod 4 (F2/F3)
packages/bots/       – Política de bot (decideBotAction) (F3)
apps/server/         – Servidor Colyseus 0.17 (F2/F3)
apps/web/            – Frontend React + Vite + Zustand + CSS Modules (F3)
tests/               – Testes da engine + servidor
scripts/sim.mts      – Script de simulação CLI
docs/decisions.md    – Decisões de produto aprovadas (D1-D6)
docs/f2.md           – F2 slice 1: escopo, aceite, decisões temporárias
```

## API pública da engine

```typescript
import { createMatch, paulista } from "@trucoviski/engine";

const match = createMatch(paulista, seed);
match.state(); // MatchState imutável
match.metadata; // MatchMetadata (versões, seed)
match.playerView(seat); // PlayerView com legalActions
match.dispatch(seat, action); // ActionResult { success, events } | { success: false, error }
```

## Wire protocol (F3)

```
Client → Server:
  { type: "action", payload: Action }      // joga carta, truco, decisão de onze
  { type: "sync" }                         // solicita estado corrente
  { type: "fillBots" }                     // dono preenche vagas com bots
  { type: "setNickname", nickname }        // troca nickname no lobby

Server → Client:
  { type: "snapshot", seat, status, connectedPlayers, metadata, view?, events?, replayMetadata?, nicknames? }
  { type: "actionRejected", error }        // erro wire ou ActionError
  { type: "ownerInfo", sessionId }         // identifica o dono da sala
```

A seed de replay não é exposta durante a partida; ela aparece somente em
`replayMetadata` após o término.

## Fluxo web (F3)

1. **Home**: escolher nickname → criar sala ou entrar por roomId.
2. **Lobby**: ver jogadores; dono pode preencher vagas com bots.
3. **Mesa**: cartas em leque, vira, placar, indicador de vez, ações (jogar
   carta, truco, mão de onze).
4. **Fim**: placar final, seed para replay.

Zustand espelha snapshots do servidor. Bots são internos ao servidor e recebem
apenas `PlayerView`/`legalActions`.

## Status

**F1 concluída.** F2 slice 1 implementado (servidor Colyseus em memória). F3
implementada: cliente web jogável (React + Vite + CSS Modules + Zustand), bots
server-side, nicknames, fillWithBots.
