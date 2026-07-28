# Plano UX — barra de ações inferior

## Diagnóstico

Hoje a parte de baixo da Mesa tem 5 botões em 3 sistemas de layout diferentes:

- `.actionArea` (Truco/Aceitar/Correr) — no fluxo flex, grid 2 colunas.
- `.logToggle` / `.socialToggle` — `position: absolute`, canto inferior direito,
  empilhados verticalmente (bottom 48px / 13px), fonte 7px.
- `.footer` (Desistir da mão / Sair) — no fluxo flex, fonte 10px.

Problemas: os absolutos flutuam por cima do footer sem alinhamento com ele;
"Truco!" (ação principal do jogo) tem o mesmo peso visual de "Sair" (ação
destrutiva de saída); alvos de toque de 32px com texto de 7px estão abaixo do
mínimo de 44px; a altura da região muda conforme `isMyTurn`, empurrando a mão.

## Princípio

Uma única barra inferior, duas faixas com hierarquia clara:

1. **Faixa de jogo** (contextual, larga, colorida): Truco / Aceitar / Correr /
   Mão de Onze. Altura reservada fixa — não empurra a mão quando some.
2. **Faixa utilitária** (discreta, ícones + label pequeno, altura constante):
   Histórico · Social · Desistir · Sair.

Nada de menu kebab/drawer novo: 4 utilitários cabem numa linha de ícones.

## Tarefas

### 1. Barra única no DOM ([Mesa.tsx](../apps/web/src/screens/Mesa.tsx))

- [x] Remover os botões absolutos `logToggle` e `socialToggle` de onde estão
      (linhas ~867–883) e movê-los para dentro do `.footer`.
- [x] Envolver `.actionArea` + `.footer` num único
      `<div className={styles.bottomBar}>` logo após `.handArea`.
- [x] Manter `data-testid` intactos: `log-toggle-btn`, `social-toggle-btn`,
      `surrender-btn`, `action-area`, `truco-*-btn`, `eleven-*-btn` (usados em
      `tests/e2e/03`, `04`, `06`, `10`).
- [x] Mover o bloco `elevenBox` (linhas ~676–697) para dentro da faixa de jogo,
      já que é decisão de mesma natureza do truco — hoje ele aparece acima da
      mão e o truco abaixo.

### 2. Reserva de altura (evitar pulo de layout)

- [x] `.gameActions` (faixa 1) com `min-height` igual à altura de um botão
      (~52px) mesmo vazia, para a mão não subir/descer entre turnos.
- [x] Remover `margin-top: 1px` de `.actionArea` e o `bottom: 48px/13px` dos
      toggles.

### 3. Hierarquia visual ([Mesa.module.css](../apps/web/src/screens/Mesa.module.css))

- [x] Faixa 1: botões full-width (grid 1fr/1fr quando há 2+), fonte 12px,
      min-height 52px, mantendo as cores atuais (rosa=raise, verde=accept,
      vermelho=run).
- [x] Faixa 2: `display: flex; justify-content: space-between;` 4 botões,
      min-height 44px, fonte 8–9px, borda 1px, cor esmaecida
      (`rgb(244 232 200 / 55%)`) — utilitário não compete com o jogo.
- [x] "Desistir" e "Sair" perdem o `border: 2px` e a cor de destaque; ficam
      iguais aos outros utilitários. A confirmação (`window.confirm`) já protege
      contra toque acidental.
- [x] Padding inferior respeitando `env(safe-area-inset-bottom)` (a gaveta
      social já faz isso; a barra ainda não).

### 4. Rótulos

- [x] "Desistir da mão" → "Desistir" (cabe em 1 linha de 9px).
- [x] Ícone + label em todos os 4: 📜 Histórico · 💬 Social · 🏳️ Desistir · 🚪
      Sair.

### 5. Verificação

- [x] `tests/e2e/03-mobile-viewport.spec.ts` — os botões continuam dentro do
      viewport e clicáveis.
- [x] Rodar `04`, `06`, `10` para os testids.
- [x] Checar visualmente com e sem `isMyTurn`: a mão não deve se mover.

## Fora de escopo (por ora)

- Menu overflow/kebab — só vale se aparecer um 5º utilitário.
- Redesenho da `.handArea` e do tabuleiro.
- Gestos (swipe pra cima já joga carta; não adicionar mais).
