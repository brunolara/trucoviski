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

Nota: o código atual persiste a sessão em `sessionStorage`.

## D7 – Substituição por bot na desconexão

Durante a partida, se um humano desconectar e ainda restar humano na sala, um
bot assume seu assento e a partida continua. Queda involuntária reserva o
assento por 180 segundos; ao voltar nessa janela, o jogador retoma o mesmo
assento e o bot deixa de jogar. Depois dela, ou após fechar a aba, o mesmo
navegador ainda retoma o assento pelo `clientId` (D-sala-5). Saída voluntária
não reserva o assento, mas também é substituída por bot e é retomável na hora.
Se não restar humano, a partida congela e a sala vazia vive 5 minutos (D-sala-1,
D-sala-2). O assento mantém o nickname original do jogador enquanto o bot joga.
Fora de escopo: turn timer, tratamento de AFK, badge visual de bot.

## Desempates aprovados (implementados na F1)

- Empate da primeira vaza (canga): a segunda vaza decide. Quem abre a segunda é
  o empatado mais próximo do jogador mão (ordem crescente circular a partir do
  dealerSeat).
- Empate das duas primeiras vazas: a terceira vaza decide.
- Canga tripla: vence o time do jogador mão.
- Empate na 3ª vaza após 1–1 (cada time venceu uma): vence o time do jogador mão
  — a mesma regra da canga tripla (`resolveHandWinner`: placar igualado após 3
  vazas). Não se usa o vencedor da 1ª vaza.
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
- Mistura de bots: antes de qualquer rearranjo manual, `fillBots` normaliza
  assentos (humanos nos mais baixos, na ordem de entrada; bots no resto) — com 2
  humanos, cada time fica com 1 humano + 1 bot. Depois que o dono rearranja
  assentos no lobby, `fillBots` preserva esse arranjo.
- Mostrar carta: recurso removido. Não há `showCard`, `cardShown` nem
  `MostrarCarta`; cartas continuam privadas conforme o `PlayerView`.

## Decisões do lobby (implementadas)

- O início da partida é manual: apenas o dono pode enviar `startGame`, e só
  quando os quatro assentos estiverem ocupados por humanos ou bots.
- No lobby, somente o dono pode trocar dois assentos. Os times são fixos por
  assento: 0/2 formam o time azul e 1/3 o vermelho. Trocar um assento vazio é
  permitido; trocar assentos durante a partida não é.
- O modo "Jogar contra bots" preenche os três assentos livres e inicia a partida
  sem exigir um clique no lobby.

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

## Decisões de sala persistente

- **D-sala-1** — Sala vazia sobrevive **5 minutos** (`EMPTY_ROOM_TTL_MS`). Vazia
  = nenhum humano conectado (bots não contam). O prazo é maior que os 180 s de
  reconexão de propósito: a reconexão nunca deve ser podada pelo TTL.
- **D-sala-2** — Com a sala em `playing` e nenhum humano conectado, **os bots
  pausam**. A partida congela exatamente onde parou e retoma quando alguém
  entra. Bot não termina partida sozinho.
- **D-sala-3** — Identidade do jogador é um `clientId` gerado no navegador e
  guardado em `localStorage`. É opaco para o servidor (string, ≤ 64 chars) e não
  é enviado a outros clientes. Cliente que não mandar `clientId` recai no
  `sessionId`.
- **D-sala-4** — Dono é o `clientId` do criador e ele **não perde a posse ao
  sair**. Enquanto o criador estiver ausente, o humano conectado mais antigo é
  **dono interino**; o criador retoma a posse ao voltar.
- **D-sala-5** — Assento pertence ao `clientId`. Voltar à sala em partida só é
  permitido a quem tem assento guardado que esteja com bot; qualquer outro
  `joinById` durante `playing`/`finished` é recusado.
- **D-sala-6** — Código de sala = duas palavras pt-BR sem acento
  (`morango-exemplar`), exibido com espaço e aceito de qualquer jeito
  (maiúscula, acento, espaço, hífen). Colisão: sorteia de novo até 10 vezes;
  esgotou, mantém o id do Colyseus.

Limitação conhecida: quem fecha a aba no meio da partida perde o
`reconnectionToken` (`sessionStorage`) e, por até 180 s, o matchmaker pode
responder "sala cheia" porque a reserva de reconexão ainda conta. Passados os
180 s, a retomada por `clientId` funciona. Saída voluntária (Sair) é retomável
na hora.

## Decisões do bot (E0 — `docs/plano-bot-forca.md`)

- **D-bot-1** — Bot de produção nunca recebe cartas privadas alheias, seed da
  partida ou `MatchState`. Só `PlayerView`. Invariante testada em
  `tests/bot-privacy.test.ts`.
- **D-bot-2** — Sem nível de dificuldade. Um único bot, sempre a melhor política
  aprovada. Sem UI de dificuldade na Home nem no lobby. Confirma
  `docs/plano-menu.md` ("sem configuração de dificuldade"). A etapa E6 do plano
  de força (Casual/Normal/Difícil) fica sem efeito.
- **D-bot-3** — Não aplicável: não há níveis. Adversários, parceiro, substituto
  de desconectado e conselho de truco usam a mesma política de produção.
- **D-bot-4** — Bot nunca usa `surrender` com humano na mesa. Continua evitado
  nas heurísticas (`heuristic2.ts`, `heuristic.ts`).
- **D-bot-5** — Dificuldade, se um dia existir, nunca se implementa com
  informação extra nem jogada ilegal. Só profundidade de busca, margem de risco,
  frequência de blefe e taxa limitada de erro deliberado. Com D-bot-2, vale como
  restrição permanente da política única.
- **D-bot-6** — Adaptação ao jogador é permitida, só com sinais **públicos**
  (truco, corrida, carta coberta, cartas reveladas na mesa) e **reiniciada a
  cada partida**. Sem perfil persistente. Ainda não implementada (E1 não a
  entrega).
