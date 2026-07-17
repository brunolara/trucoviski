# AGENTS.md

## Escopo atual

Este workspace concluiu F1, F2 slice 1, F3 (cliente web jogável com bots) e F4
(social, provocação e som sintetizado). O escopo atual é a implementação da F5
(UX mobile + PWA, incluindo layout touch-first, safe areas, manifest + service
worker, reconexão visível). Não implemente deploy (F6) ou novos slices F6+ até a
fase proprietária aprovar esse trabalho.

## Regras fixas

- R1 - Escopo: faça apenas a fase solicitada; F1 não antecipa F2.
- R2 - Decisões: não tome decisões silenciosas de regra. D1-D6 estão
  documentadas em `docs/decisions.md`.
- R3 - Engine: `packages/engine` é TypeScript puro, determinístico, sem I/O e
  sem dependências de runtime. Mantenha `dependencies` ausente de seu
  `package.json`.
- R4 - Qualidade: toda alteração deve preservar `pnpm gate`; use **mão** e
  **vaza** como termos canónicos.

## Regras de desempate (implementadas na F1)

- Empate da primeira vaza é decidido pela segunda.
- Empate das duas primeiras vazas é decidido pela terceira.
- Canga tripla vence para o time do jogador mão.

## Regras de truco (implementadas na F1)

- Valor: 1 → truco 3 → 6 → 9 → 12. Pedido alterna entre times.
- Resposta: aceitar, aumentar ou correr. Correr entrega o valor anterior ao
  pedido pendente.
- Não pode aumentar além de 12.
- Mão de onze: time decide jogar (mão fixa em 3, sem truco) ou correr (oponente
  ganha 1).
- Ferro 11×11: mão vale 3, sem truco, jogadores não veem as próprias cartas
  (PlayerView oculta).

## Engenharia

- Node 22, pnpm 11, TypeScript strict, ESLint flat config, Prettier e Vitest.
- Prefira a menor alteração correta e não adicione dependências sem necessidade
  da fase atual.
- Execute `pnpm gate` antes de concluir trabalho.
- Execute `pnpm validate:compose` quando Docker Compose estiver disponível.
- Cobertura da engine: linhas ≥95%, funções ≥95%, statements ≥95%, branches
  ≥92%.
- Simulação: `pnpm sim -- --games 10000` deve completar sem timeouts.
- Não inicialize Git neste workspace sem solicitação explícita.
