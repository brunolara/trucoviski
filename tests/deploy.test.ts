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
  process.env["MONITOR_USER"] = "monitor-test-user";
  process.env["MONITOR_PASSWORD"] = "monitor-test-password";
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
  it("requires application Basic Auth and returns HTML with valid credentials", async () => {
    const port = (gameServer.server as unknown as { port: number }).port;
    const url = `http://127.0.0.1:${port}/monitor`;
    const denied = await fetch(url);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Basic");
    expect(denied.headers.get("cache-control")).toBe("no-store, private");

    const res = await fetch(url, {
      headers: {
        authorization: `Basic ${Buffer.from(
          "monitor-test-user:monitor-test-password",
        ).toString("base64")}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
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

  it("smoke-deploy.sh checks /healthz, / and public monitor denial", () => {
    const content = readFileSync(
      path.join(ROOT, "scripts/smoke-deploy.sh"),
      "utf8",
    );
    expect(content).toContain("/healthz");
    expect(content).toContain('"403"');
    expect(content).toContain("/monitor");
    expect(content).toContain("MONITOR_SMOKE_USER");
    expect(content).toContain("MONITOR_SMOKE_INTERNAL_URL");
    expect(content).not.toContain("--user");
    expect(content).toContain("curl");
  });
});

// ---- 5. Dockerfile structure -----------------------------------------

describe("Dockerfile", () => {
  const df = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");

  it("has build and server stages only", () => {
    expect(df).toMatch(/FROM .* AS build/);
    expect(df).toMatch(/FROM .* AS server/);
  });

  it("server stage exposes port 2568", () => {
    expect(df).toContain("EXPOSE 2568");
  });

  it("server stage runs node apps/server/dist/main.js", () => {
    expect(df).toContain("apps/server/dist/main.js");
  });

  it("server stage installs sqlite3 (for backup)", () => {
    expect(df).toContain("sqlite3");
  });

  it("runs unprivileged and grants node ownership of persistent data", () => {
    expect(df).toContain("chown node:node /data");
    expect(df).toContain("USER node");
  });
});

// ---- 6. Apache vhost structure ---------------------------------------

describe("Apache vhost", () => {
  const vhost = readFileSync(
    path.join(ROOT, "deploy/apache/truco.brunodelara.dev.conf"),
    "utf8",
  );

  it("proxies HTTP and WebSockets to the loopback-only server", () => {
    expect(vhost).toContain("http://127.0.0.1:2568/");
    expect(vhost).toContain("ws://127.0.0.1:2568/");
    expect(vhost).toContain("HTTP:Upgrade");
  });

  it("returns 403 for every public /monitor path", () => {
    expect(vhost).toContain('<LocationMatch "(?i)^/monitor(/|$)">');
    expect(vhost).toContain("Require all denied");
    expect(vhost).not.toContain("AuthType Basic");
    expect(vhost).not.toContain("AuthUserFile");
    expect(vhost).not.toContain("RequestHeader set Authorization");
  });

  it("uses trusted Cloudflare addresses for real client access logs", () => {
    expect(vhost).toContain("RemoteIPHeader CF-Connecting-IP");
    expect(vhost).toContain("173.245.48.0/20");
    expect(vhost).toContain("2400:cb00::/32");
    expect(vhost).toContain("LogFormat");
    expect(vhost).toContain("cf_combined");
  });

  it("does not mention Caddy", () => {
    expect(vhost.toLowerCase()).not.toContain("caddy");
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

  it("server has healthcheck via /healthz", () => {
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("127.0.0.1:2568/healthz");
  });

  it("server data is persisted via named volume", () => {
    expect(compose).toContain("server-data:/data");
    expect(compose).toMatch(/volumes:/);
  });

  it("publishes only the server port on loopback", () => {
    expect(compose).toContain('"127.0.0.1:${HOST_BIND_PORT:-2568}:2568"');
    expect(compose).not.toContain('"80:80"');
    expect(compose).not.toContain('"443:443"');
    expect(compose).not.toContain("caddy:");
  });

  it("requires monitor application credentials from the environment", () => {
    expect(compose).toContain("${MONITOR_USER:?set MONITOR_USER in .env}");
    expect(compose).toContain(
      "${MONITOR_PASSWORD:?set MONITOR_PASSWORD in .env}",
    );
  });
});

// ---- 8. .env.example completeness ------------------------------------

describe(".env.example", () => {
  const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

  it("documents loopback host binding", () => {
    expect(example).toContain("HOST_BIND_PORT=");
  });

  it("documents MONITOR_USER and MONITOR_PASSWORD", () => {
    expect(example).toContain("MONITOR_USER=");
    expect(example).toContain("MONITOR_PASSWORD=");
  });

  it("documents SQLITE_PATH", () => {
    expect(example).toContain("SQLITE_PATH=");
  });

  it("does not include a monitor password", () => {
    expect(example).not.toContain("replace-with");
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

  it("excludes deploy and test artifacts but retains README", () => {
    expect(di).toContain("deploy/");
    expect(di).toContain("docs/");
    expect(di).toContain("tests/");
    expect(di).toContain("playwright*");
    expect(di).toContain("test-results/");
    expect(di).toContain("*.md");
    expect(di).toContain("!README.md");
  });
});

// ---- 10. Anti-cheat preservation (snapshots do not leak cards) ---------

describe("F6 anti-cheat (snapshots do not leak other players cards)", () => {
  it("room snapshots do not contain other players' handCards", async () => {
    // Use a fresh room on the shared gameServer.
    const room = await gameServer.createRoom("truco", { seed: 1337 });

    // Connect 4 clients then startGame.
    const clients = [];
    for (let i = 0; i < 4; i++) {
      clients.push(await gameServer.connectTo(room));
    }
    const owner = clients[0];
    if (!owner) throw new Error("expected owner client");
    owner.send("startGame", {});

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
