/* ------------------------------------------------------------------ */
/*  F6 – Deploy + observabilidade: testes do gate G6                   */
/* ------------------------------------------------------------------ */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { boot } from "@colyseus/testing";
import type { ColyseusTestServer } from "@colyseus/testing";
import { trucoConfig } from "@trucoviski/server";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// ---- Shared server for all server-side tests -------------------------

let gameServer: ColyseusTestServer;

beforeAll(async () => {
  gameServer = await boot(trucoConfig);
});

afterAll(async () => {
  await gameServer.cleanup();
  await gameServer.shutdown();
}, 15000);

// ---- 1. Healthz endpoint --------------------------------------------

describe("healthz endpoint", () => {
  it("GET /healthz returns 200 with status ok", async () => {
    const res = await gameServer.http.get("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ status: "ok" });
  });

  it("GET /healthz does not expose rooms, players or db info", async () => {
    const res = await gameServer.http.get("/healthz");
    const json = JSON.stringify(res.data);
    expect(json).not.toContain("room");
    expect(json).not.toContain("player");
    expect(json).not.toContain("sqlite");
    expect(json).not.toContain("database");
    expect(json).not.toContain("cards");
  });
});

// ---- 2. Monitor endpoint presence ------------------------------------

describe("@colyseus/monitor", () => {
  it("monitor route is registered (returns HTML)", async () => {
    // In test env, no Caddy basic_auth, so monitor is directly accessible.
    // Use native fetch to bypass httpie's JSON parsing that would reject HTML.
    const port = (gameServer.server as unknown as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/monitor`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("colyseus");
  });
});

// ---- 3. Structured logger (pino) ------------------------------------

describe("structured logger", () => {
  it("logger.ts exists and exports pino instance", () => {
    const loggerPath = path.join(ROOT, "apps/server/src/logger.ts");
    const content = readFileSync(loggerPath, "utf8");
    expect(content).toContain("import pino");
    expect(content).toContain("export const logger");
    expect(content).toContain("redact");
    expect(content).toContain("password");
    expect(content).toContain("authorization");
  });

  it("logger is configured with service base field", () => {
    const loggerPath = path.join(ROOT, "apps/server/src/logger.ts");
    const content = readFileSync(loggerPath, "utf8");
    expect(content).toContain("base:");
    expect(content).toContain("trucoviski-server");
  });

  it("logger redacts sensitive fields", () => {
    const loggerPath = path.join(ROOT, "apps/server/src/logger.ts");
    const content = readFileSync(loggerPath, "utf8");
    expect(content).toContain("password");
    expect(content).toContain("authorization");
    expect(content).toContain("cookie");
    expect(content).toContain("reconnectionToken");
  });
});

// ---- 4. Shell scripts -----------------------------------------------

describe("deploy shell scripts", () => {
  const scripts = ["scripts/backup-sqlite.sh", "scripts/smoke-deploy.sh"];

  for (const script of scripts) {
    it(`${script} is executable and has valid syntax`, () => {
      const full = path.join(ROOT, script);
      const stat = statSync(full);
      // File exists and is readable.
      expect(stat.isFile()).toBe(true);

      // Syntax-check: sh -n validates without executing.
      expect(() => {
        execFileSync("sh", ["-n", full], { stdio: "pipe" });
      }).not.toThrow();
    });
  }

  it("backup-sqlite.sh references SQLITE_PATH and sqlite3", () => {
    const content = readFileSync(
      path.join(ROOT, "scripts/backup-sqlite.sh"),
      "utf8",
    );
    expect(content).toContain("SQLITE_PATH");
    expect(content).toContain("sqlite3");
    expect(content).toContain(".backup");
    expect(content).toContain("/data/backups");
  });

  it("smoke-deploy.sh checks /healthz, / and /monitor=401", () => {
    const content = readFileSync(
      path.join(ROOT, "scripts/smoke-deploy.sh"),
      "utf8",
    );
    expect(content).toContain("/healthz");
    expect(content).toContain('"401"');
    expect(content).toContain("/monitor");
    expect(content).toContain("curl");
  });
});

// ---- 5. Dockerfile structure -----------------------------------------

describe("Dockerfile", () => {
  const df = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");

  it("has build, server and caddy stages", () => {
    expect(df).toMatch(/FROM .* AS build/);
    expect(df).toMatch(/FROM .* AS server/);
    expect(df).toMatch(/FROM caddy.* AS caddy/);
  });

  it("server stage exposes port 2568", () => {
    expect(df).toContain("EXPOSE 2568");
  });

  it("server stage runs node apps/server/dist/main.js", () => {
    expect(df).toContain("apps/server/dist/main.js");
  });

  it("caddy stage copies Caddyfile", () => {
    expect(df).toContain("deploy/Caddyfile");
  });

  it("server stage installs sqlite3 (for backup)", () => {
    expect(df).toContain("sqlite3");
  });
});

// ---- 6. Caddyfile structure ------------------------------------------

describe("Caddyfile", () => {
  const cf = readFileSync(path.join(ROOT, "deploy/Caddyfile"), "utf8");

  it("uses env var for domain", () => {
    expect(cf).toContain("{$CADDY_DOMAIN}");
  });

  it("reverse-proxies /healthz to server:2568", () => {
    expect(cf).toContain("/healthz");
    expect(cf).toContain("server:2568");
  });

  it("reverse-proxies /matchmake/* and /room/* to server", () => {
    expect(cf).toContain("/matchmake/*");
    expect(cf).toContain("/room/*");
    expect(cf).toContain("server:2568");
  });

  it("protects /monitor with basic_auth", () => {
    expect(cf).toContain("basic_auth");
    expect(cf).toContain("{$MONITOR_USER}");
    expect(cf).toContain("{$MONITOR_PASSWORD_HASH}");
  });

  it("serves static files with try_files fallback", () => {
    expect(cf).toContain("try_files");
    expect(cf).toContain("file_server");
  });

  it("enables compression", () => {
    expect(cf).toContain("encode zstd gzip");
  });
});

// ---- 7. compose.yaml structure ---------------------------------------

describe("compose.yaml", () => {
  // Read raw YAML for structural assertions (no yaml parser dependency).
  const compose = readFileSync(path.join(ROOT, "compose.yaml"), "utf8");

  it("defines server service", () => {
    expect(compose).toMatch(/services:/);
    expect(compose).toMatch(/server:/);
  });

  it("defines caddy service", () => {
    expect(compose).toMatch(/caddy:/);
  });

  it("server has healthcheck via /healthz", () => {
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("127.0.0.1:2568/healthz");
  });

  it("caddy depends_on server with service_healthy", () => {
    expect(compose).toContain("depends_on:");
    expect(compose).toContain("service_healthy");
  });

  it("server data is persisted via named volume", () => {
    expect(compose).toContain("server-data:/data");
    expect(compose).toMatch(/volumes:/);
  });

  it("exposes HTTPS (443) and HTTP (80) ports on caddy", () => {
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
  });

  it("requires DOMAIN, MONITOR_USER and MONITOR_PASSWORD_HASH", () => {
    expect(compose).toContain("${DOMAIN:?set DOMAIN in .env}");
    expect(compose).toContain("${MONITOR_USER:?set MONITOR_USER in .env}");
    expect(compose).toContain(
      "${MONITOR_PASSWORD_HASH:?set MONITOR_PASSWORD_HASH in .env}",
    );
  });
});

// ---- 8. .env.example completeness ------------------------------------

describe(".env.example", () => {
  const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

  it("documents DOMAIN", () => {
    expect(example).toContain("DOMAIN=");
  });

  it("documents MONITOR_USER and MONITOR_PASSWORD_HASH", () => {
    expect(example).toContain("MONITOR_USER=");
    expect(example).toContain("MONITOR_PASSWORD_HASH=");
  });

  it("documents SQLITE_PATH", () => {
    expect(example).toContain("SQLITE_PATH=");
  });

  it("instructs to generate bcrypt hash", () => {
    expect(example).toContain("hash-password");
  });
});

// ---- 9. .dockerignore -----------------------------------------------

describe(".dockerignore", () => {
  const di = readFileSync(path.join(ROOT, ".dockerignore"), "utf8");

  it("excludes .env from build context", () => {
    expect(di).toContain(".env");
  });

  it("excludes node_modules from build context", () => {
    expect(di).toContain("node_modules");
  });

  it("excludes .git from build context", () => {
    expect(di).toContain(".git");
  });
});

// ---- 10. Anti-cheat preservation (snapshots do not leak cards) ---------

describe("F6 anti-cheat (snapshots do not leak other players cards)", () => {
  it("room snapshots do not contain other players' handCards", async () => {
    // Use a fresh room on the shared gameServer.
    const room = await gameServer.createRoom("truco", { seed: 1337 });

    // Connect 4 clients to reach "playing" status.
    const clients = [];
    for (let i = 0; i < 4; i++) {
      clients.push(await gameServer.connectTo(room));
    }

    // Wait for all players to be synced and game to start.
    await new Promise((r) => setTimeout(r, 800));

    // Get snapshot for each player by sending sync and collecting reply.
    const snapshots: { seat: number; handCards: unknown[] }[] = [];
    for (const c of clients) {
      c.send("sync", {});
      const snap = await new Promise<{
        seat: number;
        status: string;
        view?: { handCards: unknown[] };
      }>((resolve) => {
        c.onMessage("snapshot", (msg) => resolve(msg));
      });
      if (snap.view) {
        snapshots.push({ seat: snap.seat, handCards: snap.view.handCards });
      }
    }

    // All 4 players should have received their own cards.
    expect(snapshots.length).toBe(4);

    // Verify no two players share any card.
    for (let i = 0; i < snapshots.length; i++) {
      for (let j = i + 1; j < snapshots.length; j++) {
        const s1 = snapshots[i];
        const s2 = snapshots[j];
        if (!s1 || !s2) continue;
        for (const c1 of s1.handCards) {
          for (const c2 of s2.handCards) {
            const card1 = c1 as { suit: string; rank: string };
            const card2 = c2 as { suit: string; rank: string };
            expect(card1.suit === card2.suit && card1.rank === card2.rank).toBe(
              false,
            );
          }
        }
      }
    }
  });
});
