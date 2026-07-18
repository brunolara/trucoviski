# Deploy do Trucoviski na VPS

Apache 2.4 do host publica o domínio; Docker Compose publica somente
`127.0.0.1:2568`. Cloudflare é responsabilidade externa e permanece intocado.

> ## Regras rígidas para a LLM executora
>
> - O monitor **não é público**: nunca exponha `/monitor` via Apache e espere
>   `403` publicamente.
> - Nunca recrie `htpasswd`, publique em `0.0.0.0`, habilite TLS/Certbot nem
>   altere Cloudflare, DNS ou seus certificados.
> - Nunca imprima senha ou hash em log, arquivo, commit, PR ou resposta.
> - Antes de `sudo`, explique que a operação altera ou lê configuração do
>   sistema e obtenha confirmação humana. Pare em qualquer falha; não improvise.

## Pré-condições

```sh
docker compose version
sudo apache2ctl -v
sudo apache2ctl -M | grep -E 'proxy_module|proxy_http_module|proxy_wstunnel_module|rewrite_module|headers_module|remoteip_module'
sudo ufw status numbered
sudo ss -ltnp '( sport = :2568 )'
```

Espere Docker Compose v2, Apache 2.4 com os módulos listados, firewall sem regra
pública para `2568`, e nenhuma escuta prévia nessa porta.

## Procedimento

1. Entre no clone, atualize as tags e verifique a proveniência antes de qualquer
   mudança. Pare se a verificação falhar. Use `git verify-tag` quando a release
   tiver tag assinada; sem ela, registre a saída de assinatura do commit.

   ```sh
   cd /caminho/absoluto/para/trucoviski
   git fetch --tags
   git status --short
   git verify-tag <tag-assinada>
   # Se não houver tag assinada:
   git log --show-signature -1
   git diff -- deploy/apache/truco.brunodelara.dev.conf
   ```

   Espere `git status --short` vazio e revise o diff do vhost antes do
   `sudo cp`.

2. Crie ou preserve o `.env` privado com `MONITOR_USER` e `MONITOR_PASSWORD`. O
   humano gera e salva a senha no gerenciador de senhas; o agente nunca a exibe.
   Não leia, versione ou faça commit de `.env`.

   ```sh
   test -f .env || cp .env.example .env
   chmod 600 .env
   ${EDITOR:-vi} .env
   ```

3. O `sudo` a seguir modifica arquivos Apache do sistema. Após confirmação
   humana, faça backup do vhost, remova o arquivo `htpasswd` legado se existir e
   instale a configuração. Não recrie o arquivo removido.

   ```sh
   sudo cp /etc/apache2/sites-available/truco.brunodelara.dev.conf /etc/apache2/sites-available/truco.brunodelara.dev.conf.before-f6
   sudo rm -f /etc/apache2/.htpasswd-trucoviski-monitor
   sudo cp deploy/apache/truco.brunodelara.dev.conf /etc/apache2/sites-available/truco.brunodelara.dev.conf
   sudo a2ensite truco.brunodelara.dev.conf
   sudo apache2ctl configtest
   sudo systemctl reload apache2
   ```

   Espere `Syntax OK` e reload sem erro.

4. Valide, construa e suba. Não prossiga se Compose acusar variável ausente.

   ```sh
   pnpm validate:compose
   docker compose up --build --detach --wait
   docker compose ps
   APP_URL=https://truco.brunodelara.dev bash scripts/smoke-deploy.sh
   ```

   Espere `server` saudável e `127.0.0.1:2568->2568/tcp`, nunca `0.0.0.0:2568`.
   O smoke exige `200` para `/` e `/healthz`, e `403` para `/monitor` público.

## Acesso ao monitor

O monitor é acessível exclusivamente por túnel SSH para o loopback do host:

```sh
ssh -L 2569:127.0.0.1:2568 user@vps
```

Abra `http://127.0.0.1:2569/monitor/`. A credencial Basic Auth está no `.env` da
VPS. O agente nunca imprime a senha; o humano a gerencia em um gerenciador de
senhas.

Para uma validação interna opcional sem senha em argumento, carregue `.env` no
shell de forma privada e use o smoke, que transmite `Authorization` por stdin:

```sh
set -a; . ./.env; set +a
MONITOR_SMOKE_INTERNAL_URL=http://127.0.0.1:2569 \
MONITOR_SMOKE_USER="$MONITOR_USER" \
MONITOR_SMOKE_PASSWORD="$MONITOR_PASSWORD" \
bash scripts/smoke-deploy.sh https://truco.brunodelara.dev
unset MONITOR_SMOKE_PASSWORD MONITOR_PASSWORD
```

## Verificações finais e rollback

```sh
curl -sSI https://truco.brunodelara.dev/
curl -sSI https://truco.brunodelara.dev/healthz
curl -sSI https://truco.brunodelara.dev/monitor
docker compose logs --tail=200 server
```

Espere `200`, `200`, `403` e nenhum erro fatal. Complete uma partida com quatro
dispositivos reais e confirme reconexão. Para rollback, pare os containers sem
volumes, restaure o vhost `.before-f6`, valide e recarregue Apache; não remova o
volume SQLite. O backup local é `bash scripts/backup-sqlite.sh`; backup externo
permanece pendência operacional.
