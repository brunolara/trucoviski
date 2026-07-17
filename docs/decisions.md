# Decisões aprovadas

## D1 – Variante paulista

Baralho francês de 40 cartas (8/9/10 removidos). Ranks do mais fraco ao mais
forte: 4, 5, 6, 7, Q, J, K, A, 2, 3. Vira pública determina manilhas: quatro
cartas do rank seguinte com wrap 3→4. Entre manilhas, a ordem de naipes é paus
(zap) > copas > espadas > ouros. Cartas não-manilha de mesmo rank empatam
independentemente do naipe.

## D2 – Frontend

React DOM + CSS Modules + Framer Motion (não implementado na F1).

## D3 – Engine

TypeScript puro, determinístico, sem I/O, sem dependências de runtime. PRNG
mulberry32 seedável com Fisher-Yates. RuleSet plugável (paulista 1.0.0
implementado). PlayerView oculta cartas alheias; no ferro (11×11) oculta também
as próprias. Ações inválidas retornam `ActionError` tipado com estado
inalterado. Replay: mesma seed + ações = mesmos eventos. Metadados públicos
incluem versão do ruleset e PRNG.

## D4 – Deploy

VPS + Docker Compose (não implementado na F1).

## D5 – Persistência

SQLite (não implementado na F1).

## D6 – Autenticação

Anónimo: nickname + token em localStorage (não implementado na F1).

## Desempates aprovados (implementados na F1)

- Empate da primeira vaza (canga): a segunda vaza decide. Quem abre a segunda é
  o empatado mais próximo do jogador mão (ordem crescente circular a partir do
  dealerSeat).
- Empate das duas primeiras vazas: a terceira vaza decide.
- Canga tripla: vence o time do jogador mão.
- Empate de não-manilhas de mesmo rank: canga independentemente do naipe.

## Regras de truco (implementadas na F1)

- Valor da mão: 1 → truco 3 → 6 → 9 → 12.
- Pedido alterna entre times; o mesmo time não aumenta a própria aposta.
- Resposta: aceitar (valor sobe para o pendente), aumentar (contra-aposta para o
  próximo nível) ou correr.
- Correr entrega ao adversário o valor anterior ao pedido pendente (nível abaixo
  na sequência).
- Não pode aumentar além de 12.
- Mão de onze (exactamente um time com 11 tentos): time decide em conjunto jogar
  (mão fixada em 3 tentos, truco proibido) ou correr (adversário ganha 1).
- Ferro 11×11 (ambos com 11): mão vale 3, truco proibido, jogadores não veem as
  próprias cartas no `PlayerView`. A engine resolve normalmente com as cartas
  reais.

Os termos canónicos são **mão** (jogador que inicia a mão) e **vaza** (rodada de
cartas). Implementações futuras não podem substituir esses termos nem tomar
decisões silenciosas de regra.
