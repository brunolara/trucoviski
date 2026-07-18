# Plano de Correções UX Mobile (Despoluição)

## Diagnóstico

Em resoluções touch, a tela de Mesa excede o `100dvh` devido ao empilhamento
vertical (topbar, board circular, área da mão, botões de ação e área
social/chat). Como não há container explícito de `overflow-y`, partes inferiores
ficam cortadas. Adicionalmente, existem comportamentos redundantes ou contrários
às regras, como botões 👁️ de mostrar cartas que poluem e furam a regra do jogo
(e o Ferro), e envio isolado de truco pelo bot aliado.

## Tarefas (Checklist)

### 1. Eliminar "Mostrar Cartas" (👁️)

- [x] UI: Em `apps/web/src/screens/Mesa.tsx`, remover o botão
      `data-testid="show-card-btn-${i}"` (linhas ~675).
- [x] UI: Remover renderização do balão de mostrar cartas (`shownCardBubble` em
      Mesa.tsx e css `Mesa.module.css`).
- [x] Store: Em `apps/web/src/store.ts`, remover `showCard(i)` e as dependências
      (`cardShown` handler).
- [x] Protocolo: Em `packages/shared/src/index.ts`, manter ou remover o schema
      `validateShowCard`, mas se mantido, desabilitar seu broadcast.
- [x] Server: Em `apps/server/src/room.ts`, bloquear ou rejeitar mensagens
      `showCard` (remover logicamente a propagação).

### 2. Condensar Chat e Emojis em Gaveta/Modal

- [x] UI: Em `Mesa.tsx`, remover renderização inline do bloco social (linhas
      ~731–763).
- [x] UI: Adicionar botão "💬 Social/Chat" na parte inferior que alterne uma
      flag (ex: `showSocialPanel`).
- [x] Modal: Quando a flag for true, abrir um modal/bottom-sheet contendo o grid
      de emojis e o input de chat.
- [x] CSS: Diminuir espaço vertical ocupado no fluxo normal (`Mesa.module.css`).
- [x] CSS: Respeitar as safe areas inferior e laterais no overlay fixo da
      gaveta.

### 3. Eliminar Botão "Jogar Carta" (Double-tap/Double-click)

- [x] UI: Em `Mesa.tsx`, remover o botão inline
      `data-testid="play-card-btn-${i}"` (linhas ~630).
- [x] Interação: Adicionar handler `onDoubleClick` ao `.card` para desktop.
- [x] Interação: Para touch, no handler existente (ou novo onClick/onTouchEnd),
      registrar tempo do toque; se `< 300ms` entre toques (double tap),
      despachar `playCard` ou `playHiddenCard` (caso a flag de coberta esteja
      ativada).
- [x] Manter o botão "🂠 Virar" visível para controle de carta coberta, mas
      reduzir impacto visual.
- [x] Ghost-click: `preventDefault()` no touch e guard por snapshot de mão,
      vaza/vez impedem dupla submissão antes da reconciliação e liberam a
      primeira carta quando o vencedor continua como mão na próxima vaza.
- [x] Acessibilidade: cartas têm `role="button"`, foco visível, rótulo
      descritivo e suporte a Enter/Espaço.

### 3.1 Acessibilidade da Gaveta Social

- [x] Modal tem `role="dialog"` e `aria-modal`, recebe foco inicial no botão de
      fechar e fecha com Escape, clique no overlay ou botão de fechar.

### 4. Bloquear Decisão Ativa do Bot Aliado

- [x] Server: Em `apps/server/src/room.ts`, na função `scheduleBotTurn`,
      verificar `hasHumanOnTeam(turnSeat)`. Se for `elevenDecision` ou resposta
      a truco (`trucoPendingTeam === botTeam`) E existir humano no time, ignorar
      despacho de ação para o bot.
- [ ] Server/Recomendação: Implementar sinalização. Quando o bot for instado a
      decidir truco, rodar a heurística. Se a recomendação for
      aceitar/correr/raise, disparar envio (ex. via emote especial 👍/👎) para
      alertar o aliado. (Para esta fase, basta o bot não intervir nas decisões
      exclusivas do humano).

### 5. Layout e Scroll Cleanup

- [x] CSS: Modificar `Mesa.module.css`. Na `@media (max-width: 600px)`, reduzir
      altura fixa da `.board` (de 380px para valor calculado que caiba).
- [x] CSS: Remover vazamentos (`min-height` abusivos) e compactar os gaps da
      column flex. Garantir safe areas funcionando e que todo o HUD caiba no
      `100dvh` do celular sem scroll externo (ou controlar via flex).

## Validação e Critérios de Aceite

- [x] `pnpm gate` passa.
- [ ] Viewport de mobile (iPhone SE 667px altura) deve exibir a mesa inteira
      (placar + círculo + mão) sem barras de rolagem.
- [ ] Duplo clique ou arrastar deve jogar a carta.
- [ ] Não há erro de compilação ou teste falhando por remover a funcionalidade
      "mostrar cartas".
- [ ] O bot não rouba a vez do jogador ao decidir truco.
