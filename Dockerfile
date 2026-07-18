FROM node:22.13.0-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@11.13.1

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22.13.0-bookworm-slim AS server

WORKDIR /app

ENV NODE_ENV=production \
    PORT=2568 \
    SQLITE_PATH=/data/trucoviski.sqlite

RUN apt-get update \
    && apt-get install --no-install-recommends -y sqlite3 \
    && mkdir -p /data \
    && chown node:node /data \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

USER node

EXPOSE 2568

CMD ["node", "apps/server/dist/main.js"]
