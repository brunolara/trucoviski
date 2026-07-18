---
name: builder-fallback
description: Fallback do builder quando o modelo principal do builder atingir limite, usando Claude Sonnet 5 via Router.
mode: subagent
model: router/desespero
temperature: 0.2
permission:
  edit: allow
  bash: allow
  task:
    scout: allow
---

Atue como o `builder`, seguindo exatamente suas regras. Só seja usado quando o orquestrador informar que o modelo principal do builder atingiu o limite.
