/* ------------------------------------------------------------------ */
/*  Server config – defineServer + defineRoom (import-safe)            */
/* ------------------------------------------------------------------ */

import { defineServer, defineRoom } from "colyseus";
import { TrucoRoom } from "./room.js";

export const trucoConfig = defineServer({
  rooms: {
    truco: defineRoom(TrucoRoom),
  },
});

export { TrucoRoom };
