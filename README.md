# Truco Online 2D

Monorepo de um jogo de **Truco Paulista** online para quatro jogadores. A engine
é determinística; o servidor Colyseus é autoritativo; o cliente é React com
interface mobile e PWA. O deploy F6 está implementado para uma VPS com Apache no
host e Docker Compose em loopback.

## Requisitos

- Node.js `>=22.13.0 <23`
- pnpm `>=11 <12` (o projeto fixa `pnpm@11.13.1`)
- Corepack
- Docker Compose, somente para validar ou executar o deploy

## Executar localmente

```sh
corepack enable
pnpm install
```

Em terminais separados, inicie o servidor e o cliente:

```sh
cd apps/server && pnpm dev
```

```sh
cd apps/web && pnpm dev
```

Abra <http://localhost:5173>. Em desenvolvimento, o cliente conecta ao servidor
em `http://localhost:2568`; use `VITE_SERVER_URL` para apontá-lo para outro
endereço.

## Como jogar

1. Informe um nome na Home.
2. Escolha **Jogar contra bots** para iniciar uma mesa com três bots, ou
   **Versus** para criar/entrar em uma sala.
3. No lobby, o dono pode preencher vagas com bots, organizar os assentos por
   toque ou arrasto e iniciar a partida quando houver quatro participantes.

Os assentos `0`/`2` formam o time azul e `1`/`3` o time vermelho. O cliente
preserva a sessão da aba para reconexão enquanto a sala estiver ativa.

## Funcionalidades

- Truco Paulista para quatro jogadores, com servidor autoritativo e bots
  executados no servidor.
- Truco, mão de onze, ferro, cartas cobertas a partir da segunda vaza e
  desistência da mão.
- Chat, emojis, tomates, histórico da partida, apresentação de vazas/mãos,
  controles por clique, toque ou arrasto e PWA instalável.
- Reconexão: um bot assume temporariamente o assento de um humano desconectado e
  o libera se ele retornar em até 180 segundos.

As regras e decisões de produto estão em [docs/decisions.md](docs/decisions.md).

## Scripts

| Comando                                                     | Finalidade                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm gate`                                                 | Formatação, lint, tipos, testes com cobertura da engine, simulação heurística e build. |
| `pnpm format` / `pnpm format:check`                         | Aplica / verifica Prettier.                                                            |
| `pnpm test`                                                 | Executa os testes Vitest.                                                              |
| `pnpm test:e2e`                                             | Executa os testes Playwright.                                                          |
| `pnpm sim -- --games N`                                     | Simula `N` jogos aleatórios; o padrão é 1000.                                          |
| `pnpm arena -- --a heuristic-v3 --b heuristic-v2 --games N` | Mede políticas de bot em arena.                                                        |
| `pnpm sweep:v3`                                             | Executa a varredura de calibração do bot v3.                                           |
| `pnpm validate:compose`                                     | Valida `compose.yaml`; requer Docker Compose.                                          |

Antes de concluir uma alteração, execute `pnpm gate`. Para uma alteração na
engine, também execute `pnpm sim -- --games 10000`.

## Deploy na VPS

A topologia de produção tem um único container `server`, que atende os arquivos
estáticos, HTTP e WebSocket em `127.0.0.1:2568`. O Apache do host é o único
proxy público. Não exponha essa porta em `0.0.0.0` nem altere Cloudflare, DNS,
TLS ou certificados.

Antes do primeiro deploy, siga integralmente
[docs/f6-operations.md](docs/f6-operations.md). O procedimento inclui revisar e
instalar o vhost versionado em `deploy/apache/`, criar o `.env` privado e pedir
confirmação humana antes de qualquer `sudo`.

Na VPS já configurada, faça backup, valide, suba e rode o smoke:

```sh
bash scripts/backup-sqlite.sh
pnpm validate:compose
docker compose up --build --detach --wait --remove-orphans
APP_URL=https://truco.brunodelara.dev bash scripts/smoke-deploy.sh
```

O `.env` contém `MONITOR_USER` e `MONITOR_PASSWORD`: não o versione, não exiba
as credenciais e mantenha permissão `600`. O monitor público deve responder
`403`; o acesso administrativo é apenas por túnel SSH e Basic Auth. Consulte o
guia operacional para validação autenticada, logs, backup e rollback.

## Estrutura

```text
apps/server/       servidor Colyseus, HTTP, monitor e arquivos estáticos
apps/web/          cliente React, Vite, Zustand e PWA
packages/engine/   regras TypeScript puras, determinísticas e sem I/O
packages/shared/   contrato wire e validação Zod
packages/bots/     políticas dos bots
scripts/           simulações, arena, backup, smoke e sweep
deploy/apache/     vhost Apache para a VPS
docs/              decisões, operação e registros de planos técnicos
tests/             testes unitários, integração e e2e
```

## API pública da engine

```ts
import { createMatch, paulista } from "@trucoviski/engine";

const match = createMatch(paulista, seed);
match.state(); // MatchState imutável
match.metadata; // MatchMetadata (inclui seed)
match.playerView(seat); // PlayerView com legalActions
match.dispatch(seat, action); // ActionResult
```

`PlayerView` não expõe cartas alheias; em ferro (11×11), não expõe nem as
próprias cartas. A seed é ocultada no protocolo enquanto a partida está ativa e
só aparece em `replayMetadata` ao final.

## Protocolo wire

O cliente usa `room.send(tipo, payload)` do Colyseus. Mensagens aceitas:

```text
"action",       { payload: Action }
"sync",         {}
"fillBots",     {}                  # somente o dono, no lobby
"startGame",    {}                  # somente o dono, com quatro assentos ocupados
"swapSeats",    { a: 0..3, b: 0..3 } # somente o dono, no lobby
"setNickname",  { nickname: string }
"chat",         { text: string }
"emote",        { emoji: string }
"throwTomato",  { targetSeat: 0..3 }
```

O servidor envia `snapshot` (estado, assento, participantes, proprietário,
nicknames, bots, eventos, histórico e, quando aplicável, a visão privada) e
`actionRejected` para ações inválidas. Os tipos e validadores vivem em
`packages/shared/src/index.ts`.

## Documentação adicional

- [Decisões de produto e regras](docs/decisions.md)
- [Operação, deploy, monitor, backup e rollback](docs/f6-operations.md)
- [Plano e medições do bot v3](docs/plano-bot-v3.md)
- [Registro do lobby com início manual e duplas](docs/plano-lobby-start-duplas.md)
- [Registro da tela de menu](docs/plano-menu.md)
- [Medições de performance da arena](docs/plano-perf-arena.md)
