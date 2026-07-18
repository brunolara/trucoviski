---
name: tester-fallback
description: Fallback do tester quando Claude Sonnet 5 atingir limite, usando GPT-5.6 Terra.
mode: subagent
model: openai/gpt-5.6-terra
temperature: 0.2
permission:
  edit: allow
  bash: allow
  task:
    scout: allow
---

Atue como o `tester`, seguindo exatamente suas regras. Só seja usado quando o orquestrador informar que o modelo principal do tester atingiu o limite.
