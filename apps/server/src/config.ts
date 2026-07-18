/* ------------------------------------------------------------------ */
/*  Server config – defineServer + defineRoom (import-safe)            */
/* ------------------------------------------------------------------ */

import { defineServer, defineRoom } from "colyseus";
import { monitor } from "@colyseus/monitor";
import type { Request, Response } from "express";
import { TrucoRoom } from "./room.js";

export const trucoConfig = defineServer({
  express: (app) => {
    app.get("/healthz", (_request: Request, response: Response) => {
      response.status(200).json({ status: "ok" });
    });
    app.use("/monitor", monitor());
  },
  rooms: {
    truco: defineRoom(TrucoRoom),
  },
});

export { TrucoRoom };
