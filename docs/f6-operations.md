# F6 — operação em VPS

## Preparação

1. Instale Docker Engine com Docker Compose v2 e aponte o DNS do domínio para a
   VPS. Libere TCP 80/443 e UDP 443 no firewall.
2. Copie `.env.example` para `.env` **somente na VPS**. Defina `DOMAIN` e um
   hash bcrypt para o monitor; não use nem versione senha em texto puro.

   ```sh
   docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'uma-senha-longa-e-unica'
   ```

3. Valide e publique:

   ```sh
   docker compose config --quiet
   docker compose up --build --detach --wait
   APP_URL=https://seu-dominio.example bash scripts/smoke-deploy.sh
   ```

O Caddy é o único serviço publicado. Ele serve o cliente estático, termina TLS
automaticamente e encaminha matchmaking/Room WebSockets ao server interno. O
monitor fica em `https://DOMINIO/monitor` e exige HTTP Basic Auth.

## Logs e saúde

Os logs do server são JSON estruturado em stdout (Pino):

```sh
docker compose logs --follow server
curl --fail https://seu-dominio.example/healthz
```

`/healthz` não expõe dados de salas, jogadores ou banco. O healthcheck do
Compose usa esse endpoint antes de iniciar o Caddy.

## Backup SQLite

O banco deve usar `SQLITE_PATH=/data/trucoviski.sqlite`, que fica no volume
persistente `server-data`. Depois que o banco existir, execute:

```sh
bash scripts/backup-sqlite.sh
```

O script usa `.backup` do SQLite (não uma cópia de arquivo em uso) e grava em
`/data/backups` do mesmo volume. Agende-o diariamente no cron da VPS e copie os
arquivos para armazenamento externo; mantenha e teste uma política de retenção
fora do repositório. O script falha se o banco ainda não existir, evitando um
backup falso.

## Smoke pós-deploy

`smoke-deploy.sh` valida cliente estático, saúde e que o monitor responde 401
sem credencial. Para também validar a credencial do monitor sem gravá-la em
arquivo, forneça variáveis efêmeras:

```sh
APP_URL=https://seu-dominio.example \
MONITOR_SMOKE_USER=admin \
MONITOR_SMOKE_PASSWORD='senha-secreta' \
bash scripts/smoke-deploy.sh
```

## Gate humano G6

Ainda é necessário completar uma partida em produção usando quatro dispositivos
reais e confirmar que o monitor autenticado é acessível.
