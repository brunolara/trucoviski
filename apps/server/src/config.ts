/* ------------------------------------------------------------------ */
/*  Server config – defineServer + defineRoom (import-safe)            */
/* ------------------------------------------------------------------ */

import { defineServer, defineRoom } from "colyseus";
import { monitor } from "@colyseus/monitor";
import type { Request, Response } from "express";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { TrucoRoom } from "./room.js";

function monitorAuth(
  request: Request,
  response: Response,
  next: () => void,
): void {
  const user = process.env["MONITOR_USER"];
  const password = process.env["MONITOR_PASSWORD"];
  const authorization = request.get("authorization");
  const unauthorized = (): void => {
    response.set("Cache-Control", "no-store, private");
    response.set("WWW-Authenticate", 'Basic realm="Trucoviski monitor"');
    response.sendStatus(401);
  };

  if (!user || !password || !authorization?.startsWith("Basic ")) {
    unauthorized();
    return;
  }

  let supplied: string;
  try {
    supplied = Buffer.from(
      authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8");
  } catch {
    unauthorized();
    return;
  }

  const expected = createHash("sha256").update(`${user}:${password}`).digest();
  const actual = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(actual, expected)) {
    unauthorized();
    return;
  }

  response.set("Cache-Control", "no-store, private");
  next();
}

const websocketOrigins = new Set([
  "https://truco.brunodelara.dev",
  "http://localhost:5173",
]);

function isLoopback(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

const matchmakeRateLimit = rateLimit({ windowMs: 60_000, limit: 60 });
const monitorRateLimit = rateLimit({ windowMs: 60_000, limit: 20 });

export const trucoConfig = defineServer({
  express: (app) => {
    app.disable("x-powered-by");
    app.set("trust proxy", 1);
    app.use(
      helmet({
        contentSecurityPolicy: {
          useDefaults: false,
          directives: {
            baseUri: ["'self'"],
            defaultSrc: ["'self'"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://api.dicebear.com"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "https://fonts.googleapis.com"],
            connectSrc: [
              "'self'",
              "wss://truco.brunodelara.dev",
              "ws://localhost:5173",
            ],
          },
        },
        strictTransportSecurity: false,
      }),
    );
    app.use((request, response, next) => {
      if (request.headers.upgrade?.toLowerCase() !== "websocket") {
        next();
        return;
      }

      const origin = request.get("origin");
      // Native clients omit Origin; accept those only over a loopback tunnel.
      if (
        origin
          ? websocketOrigins.has(origin)
          : isLoopback(request.socket.remoteAddress)
      ) {
        next();
        return;
      }

      response.sendStatus(403);
    });
    app.use("/matchmake", matchmakeRateLimit);
    app.get("/healthz", (_request: Request, response: Response) => {
      response.status(200).json({ status: "ok" });
    });
    app.use("/monitor", monitorRateLimit, monitorAuth, monitor());

    const webDist = path.resolve(process.cwd(), "apps/web/dist");
    app.use(express.static(webDist));
    app.use((request, response, next) => {
      if (
        request.method === "GET" &&
        request.accepts("html") &&
        !request.path.startsWith("/matchmake") &&
        !request.path.startsWith("/room")
      ) {
        response.sendFile(path.join(webDist, "index.html"));
        return;
      }
      next();
    });
  },
  rooms: {
    truco: defineRoom(TrucoRoom),
  },
});

export { TrucoRoom };
