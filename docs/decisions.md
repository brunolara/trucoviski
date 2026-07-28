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

## Decisões F5 (implementadas)

- Carta coberta fora do ferro: permitida a partir da 2ª vaza (nunca na 1ª).
  Nunca vence a vaza e nunca é revelada (nem no fim da mão); o engine não guarda
  qual carta era — só remove-a da mão e marca o slot `null`+`covered`.
- Desistir da mão: ação individual e imediata de qualquer jogador na fase
  `playing` sem truco pendente (mesmo fora da vez, inclusive em mão de onze e
  ferro); o time adversário ganha o `trucoValue` vigente.
- Botões de truco: rótulos refletem o valor real ("Truco!", "Pedir Seis!",
  "Pedir Nove!", "Pedir Doze!", "Aceitar (vale N)").
- Bug do botão "Preencher com Bots" sumindo com 2+ humanos: causa raiz era a
  mensagem dedicada `ownerInfo`, enviada uma única vez no `onJoin` antes de o
  cliente registrar handlers (descartada pelo Colyseus); corrigido embutindo
  `ownerSessionId` em todo `SnapshotMessage`. Corrigido também um problema
  correlato: `onJoin` só notificava os presentes quando a sala enchia, deixando
  o lobby do dono desatualizado com 2-3 jogadores.
- Mistura de bots: `fillBots` normaliza assentos (humanos nos mais baixos, na
  ordem de entrada; bots no resto) — com 2 humanos, cada time fica com 1
  humano + 1 bot.
- Mostrar carta: recurso removido. Não há `showCard`, `cardShown` nem
  `MostrarCarta`; cartas continuam privadas conforme o `PlayerView`.

## Decisões F6 (deploy adaptado — implementadas)

- Topologia sem Caddy: um único container `server` serve estáticos do web, HTTP
  e WebSocket/Colyseus na porta interna 2568.
- Apache do host é o único reverse proxy; o projeto não publica 80/443. O
  container publica somente em loopback:
  `127.0.0.1:${HOST_BIND_PORT:-2568}:2568`.
- Monitor não é publicamente acessível — acesso exclusivo via túnel SSH ao
  loopback do host; Apache retorna `403` em `/monitor`; aplicação mantém Basic
  Auth para o acesso via túnel.
- A aplicação compara hashes SHA-256 dos pares `MONITOR_USER:MONITOR_PASSWORD`
  com `timingSafeEqual`. A senha real é gerada na VPS, nunca é commitada; `.env`
  fica fora do git (`chmod 600`) e `.env.example` tem valor em branco.
- Cloudflare permanece intocado por decisão do humano (fora de escopo; não
  configurar nem alterar). SSL/TLS de borda atual é responsabilidade externa.
- Backup: dump local via `sqlite3 .backup` no volume; cópia externa é pendência
  operacional documentada, sem adicionar dependência.
- Smoke pós-deploy valida home (200), `/healthz` (200) e `/monitor` público
  bloqueado (403). A validação autenticada ocorre opcionalmente pelo túnel SSH.
