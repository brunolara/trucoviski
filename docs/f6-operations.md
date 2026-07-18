# F6 — operação na VPS com Apache

## Topologia e limites

Apache é o único serviço público HTTP/HTTPS. O container `server` atende os
estáticos, HTTP e WebSocket/Colyseus na porta interna `2568`, publicada somente
em `127.0.0.1:${HOST_BIND_PORT:-2568}:2568`. Ele executa como o usuário `node` e
o volume `/data` pertence a esse usuário. Não há Caddy e Docker não publica `80`
nem `443`.

O Apache confia em `CF-Connecting-IP` somente nas faixas Cloudflare registradas
no vhost, para que os logs `cf_combined` usem o IP real. Cloudflare permanece
fora de escopo: não altere DNS, TLS ou configurações de borda.

## Monitor

`/monitor` não é público: Apache retorna `403`, inclusive para caminhos com
barra final. Não use `htpasswd`; caso exista o arquivo legado, remova-o somente
após confirmação humana. A aplicação continua exigindo Basic Auth com as
credenciais privadas em `.env` e responde com
`Cache-Control: no-store, private`.

Para acessá-lo, abra um túnel SSH em uma máquina confiável:

```sh
ssh -L 2569:127.0.0.1:2568 user@vps
```

Abra `http://127.0.0.1:2569/monitor/`. A credencial vem do `.env` da VPS; o
agente nunca imprime a senha. O humano a guarda e gerencia em um gerenciador de
senhas.

## Deploy e atualização

1. Atualize e verifique o checkout antes de qualquer `sudo`. Pare se uma
   verificação falhar. Se houver uma tag assinada para o commit, verifique-a;
   caso contrário, inspecione a assinatura do commit. Revise o diff do vhost
   antes de copiá-lo.

   ```sh
   git fetch --tags
   git status --short
   git verify-tag <tag-assinada> # quando a release tiver tag assinada
   # sem tag assinada:
   git log --show-signature -1
   git diff -- deploy/apache/truco.brunodelara.dev.conf
   ```

2. O `sudo` seguinte altera arquivos Apache do sistema. Após confirmação humana,
   preserve o vhost, remova a credencial Apache legada se ela existir e instale
   a configuração versionada:

   ```sh
   sudo cp /etc/apache2/sites-available/truco.brunodelara.dev.conf \
     /etc/apache2/sites-available/truco.brunodelara.dev.conf.before-f6
   sudo rm -f /etc/apache2/.htpasswd-trucoviski-monitor
   sudo install -m 644 deploy/apache/truco.brunodelara.dev.conf \
     /etc/apache2/sites-available/truco.brunodelara.dev.conf
   sudo a2ensite truco.brunodelara.dev.conf
   sudo apache2ctl configtest
   sudo systemctl reload apache2
   ```

3. Crie ou atualize `.env` privadamente (`chmod 600`) com `MONITOR_USER` e
   `MONITOR_PASSWORD`; não o leia ou versione. Valide e suba:

   ```sh
   pnpm validate:compose
   docker compose up --build --detach --wait --remove-orphans
   docker compose ps
   APP_URL=https://truco.brunodelara.dev bash scripts/smoke-deploy.sh
   ```

   Espere home e `/healthz` com `200`, `/monitor` público com `403`, e a porta
   `127.0.0.1:2568->2568/tcp`, nunca `0.0.0.0`.

4. Opcionalmente, valide Basic Auth pelo túnel sem colocá-la em argumentos. Com
   o túnel aberto e as variáveis já carregadas de `.env`, execute:

   ```sh
   MONITOR_SMOKE_INTERNAL_URL=http://127.0.0.1:2569 \
   MONITOR_SMOKE_USER="$MONITOR_USER" \
   MONITOR_SMOKE_PASSWORD="$MONITOR_PASSWORD" \
   bash scripts/smoke-deploy.sh https://truco.brunodelara.dev
   ```

## Saúde, backup e pendências

`/healthz` é o healthcheck do Compose. Helmet desabilita HSTS (Cloudflare usa
Flexible) e define CSP; o servidor também remove `X-Powered-By`, limita
`/matchmake` a 60/minuto e `/monitor` a 20/minuto por IP confiável.

O backup local usa `bash scripts/backup-sqlite.sh` e `.backup` do SQLite no
volume `/data/backups`. Backup externo continua pendente operacional: definir
destino, retenção e restauração testada antes de depender dele.
