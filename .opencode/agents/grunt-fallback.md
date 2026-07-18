---
name: grunt-fallback
description: Fallback mecânico do grunt quando o modelo principal do grunt atingir limite, usando Claude Sonnet 5 via Router.
mode: subagent
model: router/desespero
temperature: 0.2
permission:
  edit: allow
  bash: allow
  task:
    scout: allow
---

Atue como o `grunt`, seguindo exatamente suas regras. Só seja usado quando o orquestrador informar que o modelo principal do grunt atingiu o limite.
