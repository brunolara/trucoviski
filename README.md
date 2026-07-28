# Truco Online 2D

Monorepo do Truco Paulista online. **F1–F5 concluídas; F6 (deploy e
observabilidade) implementada para a VPS.**

## Requisitos

- Node.js `>=22.13.0 <23`
- pnpm `>=11 <12`
- Docker com Compose (opcional, `pnpm validate:compose`)

## Quick start local

Pré-requisitos: Node.js `>=22.13.0 <23`, pnpm `>=11 <12` e Corepack. A execução
local usa **dois terminais**: um para o servidor e outro para o frontend.

```sh
corepack enable
pnpm install
```

No primeiro terminal, inicie o servidor:

```sh
cd apps/server && pnpm dev
```

No segundo, inicie o frontend:

```sh
cd apps/web && pnpm dev
```

Abra http://localhost:5173. O frontend de desenvolvimento conecta ao servidor em
http://localhost:2568.

Docker Compose é a topologia de deploy da VPS, não o fluxo local do jogo: ele
exige as credenciais privadas do monitor e publica a porta apenas em loopback.

## Scripts

- `pnpm gate`: format check, lint, tipos, testes (com cobertura ≥95%), build.
- `pnpm format`: aplica Prettier.
- `pnpm sim -- --games N`: simulação de N jogos aleatórios com políticas legais
  (default 1000).
- `pnpm validate:compose`: valida `compose.yaml`; requer Docker Compose.
- `bash scripts/smoke-deploy.sh https://dominio`: smoke pós-deploy (cliente,
  saúde e proteção do monitor).
- `bash scripts/backup-sqlite.sh`: backup consistente do SQLite no volume da
  VPS; consulte `docs/f6-operations.md`.
- `cd apps/web && pnpm dev`: frontend Vite em http://localhost:5173.
- `cd apps/server && pnpm dev`: servidor Colyseus em http://localhost:2568.

## Features do jogo

- Truco Paulista para quatro jogadores, com salas que podem ser completadas por
  bots; com dois humanos, eles ficam em times opostos.
- Carta coberta a partir da segunda vaza: não vence a vaza nem revela a carta.
  Também é possível desistir da mão quando não há pedido de truco pendente.
- Ações de truco exibem o próximo valor aplicável; mão de onze e ferro têm
  controles próprios.
- Mesa com placar, times azul e vermelho, avatares e indicação de vez; a
  apresentação pausa para mostrar o resultado das vazas e das mãos.
- Cartas podem ser jogadas por duplo clique, duplo toque ou arrasto; a interface
  inclui ajustes para mobile e PWA instalável.
- Chat, emojis, tomates e histórico da partida ficam disponíveis na mesa.
- Reconexão automática preserva a sessão da aba quando a sala ainda está ativa.

## Deploy na VPS

Leia e siga [deploy.md](deploy.md) antes do primeiro deploy: ele contém as
pré-condições do Apache, confirmação humana antes de `sudo`, preservação do
vhost e o procedimento para criar o `.env` privado. Não versione nem exiba esse
arquivo; ele contém `MONITOR_USER` e `MONITOR_PASSWORD` e deve ter permissão
`600`.

Na atualização de uma VPS já configurada, verifique a proveniência do checkout
conforme o procedimento operacional, faça o backup local e então valide, suba e
execute o smoke:

```sh
bash scripts/backup-sqlite.sh
pnpm validate:compose
docker compose up --build --detach --wait --remove-orphans
APP_URL=https://truco.brunodelara.dev bash scripts/smoke-deploy.sh
```

O único container `server` atende estáticos, HTTP e WebSocket em
`127.0.0.1:2568`; Apache do host publica o domínio. Confirme que o smoke retorna
`200` para a home e `/healthz`, e `403` para `/monitor` público. O monitor é
acessível somente por túnel SSH e também exige Basic Auth. Não exponha a porta
em `0.0.0.0`, não altere Cloudflare, DNS, TLS ou certificados, e não recrie
`htpasswd`.

Para o acesso interno ao monitor, validação autenticada, logs e rollback sem
remover o volume SQLite, consulte [docs/f6-operations.md](docs/f6-operations.md)
e [deploy.md](deploy.md). O backup externo ainda é uma pendência operacional.

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
docs/f6-operations.md – Operação, monitor, backup e rollback do deploy
docs/plano-bot-v3.md – Plano preservado do bot v3
docs/plano-perf-arena.md – Plano preservado da arena de performance
docs/plano-menu.md – Backlog F7 não implementado: modos de jogo
docs/v3-sweep-result.json – Resultado do sweep do bot v3
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
  { type: "snapshot", seat, status, connectedPlayers, ownerSessionId, metadata, view?, events?, replayMetadata?, nicknames? }
  { type: "actionRejected", error }        // erro wire ou ActionError
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

**F1–F5 concluídas.** A aplicação inclui engine, servidor autoritativo, cliente
web jogável, bots server-side, recursos sociais, UX mobile/PWA e reconexão. **F6
está implementada e autorizada:** Docker Compose executa um único `server` em
loopback atrás do Apache do host, com healthcheck, monitor protegido, smoke
pós-deploy e backup local do SQLite. Veja
[docs/f6-operations.md](docs/f6-operations.md) para a operação.
