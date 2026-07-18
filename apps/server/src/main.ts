/* ------------------------------------------------------------------ */
/*  Server entry point – listen on PORT                                */
/* ------------------------------------------------------------------ */

import { listen } from "colyseus";
import { trucoConfig } from "./config.js";
import { logger } from "./logger.js";

const rawPort = process.env["PORT"] ?? "2568";
const PORT = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  logger.fatal({ rawPort }, "PORT must be an integer between 1 and 65535");
  process.exit(1);
}

await listen(trucoConfig, PORT);
{
  logger.info({ port: PORT }, "Truco server listening");
}
