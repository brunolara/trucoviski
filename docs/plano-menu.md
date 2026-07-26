# Plano — Tela de menu com modos de jogo

Status: proposta. Fora de F0–F6. Tratar como novo slice de backlog (F7). Requer
autorização explícita do humano antes de implementar.

## Objetivo

Dar ao jogador uma escolha explícita de modo na entrada do app:

- **Jogar contra bots** — cria partida imediata com 1 humano + 3 bots.
- **Versus** — fluxo atual, com lobby, código de sala e convite.

Em ambos os modos o jogador informa o próprio nome.

## Fluxo

```text
Início
├── Nome do jogador — obrigatório
├── Jogar contra bots
│   └── cria sala → adiciona 3 bots → abre mesa
└── Versus
    ├── Criar sala
    └── Entrar em sala por código
```

## Decisões confirmadas

- Usar a `Home` existente como menu. Sem tela ou rota nova.
- Campo de nome único, compartilhado pelos dois modos.
- **Jogar contra bots:** sempre 1 humano + 3 bots.
- Pular lobby nesse modo.
- **Versus:** manter fluxo atual, incluindo lobby e convite.
- Manter "Preencher com Bots" no lobby versus. Útil quando faltam jogadores.
- Manter reconexão automática atual.
- Sem dependências novas.
- Sem mudança em `packages/engine`.
- Sem mudança no protocolo de `packages/shared`.
- Sem mudança no servidor: o criador já é owner e pode enviar `fillBots`.
- Sem configuração de quantidade ou dificuldade dos bots.

## Etapas

### 1. Ajustar store

Arquivo: `apps/web/src/store.ts`

Adicionar ação:

```ts
createBotGame(): Promise<void>
```

Comportamento:

1. Validar nome.
2. Criar sala `truco`.
3. Registrar handlers.
4. Persistir sessão.
5. Enviar `fillBots`.
6. Snapshot `playing` leva o usuário para `mesa`.

Reutilizar a lógica atual de `createRoom`; extrair helper somente se reduzir
duplicação real.

### 2. Transformar Home em menu

Arquivos:

- `apps/web/src/screens/Home.tsx`
- `apps/web/src/screens/Home.module.css`

Conteúdo:

1. Título.
2. Campo "Seu nome".
3. Botão principal "Jogar contra bots".
4. Seção "Versus".
5. Botão "Criar sala".
6. Campo de código e botão "Entrar em sala".

Estados:

- Nome vazio desabilita todos os caminhos.
- Durante conexão, desabilitar ações.
- Erros continuam na própria tela.
- Controles com alvo mínimo de toque e layout válido em 390 px.

### 3. Preservar lobby versus

Sem mudança funcional em:

- `apps/web/src/screens/Lobby.tsx`
- criação de sala versus;
- entrada por código;
- compartilhamento de sala;
- botão "Preencher com Bots".

### 4. Testes

#### Store e integração

Cobrir:

- jogo contra bots exige nome;
- cria sala com o nome informado;
- envia `fillBots` após conexão;
- erro de criação volta a um estado utilizável;
- fluxo versus não envia `fillBots`;
- snapshots mudam `lobby` para `mesa` corretamente.

#### E2E

Atualizar ou criar cenários:

1. Informar nome.
2. Clicar "Jogar contra bots".
3. Confirmar mesa com humano + 3 bots.
4. Jogar até o fim ou confirmar estado inicial válido.
5. Informar nome e criar sala versus.
6. Confirmar lobby.
7. Segundo jogador entra por código.
8. Confirmar nomes no lobby.
9. Verificar layout em viewport de 390 px.
10. Verificar navegação por teclado e foco visível.

### 5. Gates

```bash
pnpm gate
pnpm sim -- --games 10000
```

Rodar E2E conforme o script existente do projeto.

## Critérios de aceite

- [ ] Home pede nome antes de qualquer modo.
- [ ] "Jogar contra bots" cria jogo com exatamente 1 humano e 3 bots.
- [ ] Modo bots abre a mesa sem ação manual no lobby.
- [ ] Nome informado aparece corretamente na partida.
- [ ] "Versus" preserva criação e entrada em lobby.
- [ ] Código de sala continua funcional.
- [ ] Reconexão continua funcional nos dois modos.
- [ ] Erro de rede não deixa a interface travada.
- [ ] Interface funciona em 390 px.
- [ ] Navegação por teclado e foco continuam acessíveis.
- [ ] Nenhuma carta privada vaza.
- [ ] `pnpm gate` verde.
- [ ] Simulação de 10 mil partidas passa.

## Riscos

| Risco                              | Mitigação                                              |
| ---------------------------------- | ------------------------------------------------------ |
| E2E atual assume `fillBots` manual | Atualizar `tests/e2e/01-human-with-bots.spec.ts`       |
| Corrida entre lobby e mesa         | `applySnapshot` já força `screen: "mesa"` em `playing` |
| Reconexão cair em tela errada      | `boot()` entra em `lobby`; snapshot seguinte corrige   |
| Scope creep de matchmaking         | Escopo fechado abaixo                                  |

## Fora do escopo

- Matchmaking.
- Seleção de quantidade de bots.
- Dificuldade de bot.
- Modo local.
- Login ou conta.
- Ranking.
- Alteração de regras.
- Tela adicional de seleção.
- Mudanças de deploy F6.

## Próximo passo

Despachar a implementação ao `builder` quando o humano pedir. Depois, `tester`
para os testes e `reviewer` para a revisão.
