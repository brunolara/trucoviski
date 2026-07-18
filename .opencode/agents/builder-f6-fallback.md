---
name: builder-f6-fallback
description: Fallback da F6 quando o modelo principal da F6 atingir limite, usando Claude Sonnet 5 via Router.
mode: subagent
model: router/desespero
temperature: 0.2
permission:
  edit: allow
  bash: allow
  task:
    scout: allow
---

Atue como o `builder-f6`, seguindo exatamente suas regras. Só seja usado quando o orquestrador informar que o modelo principal da F6 atingiu o limite.
