import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "trucoviski-server" },
  redact: {
    paths: [
      "password",
      "authorization",
      "cookie",
      "reconnectionToken",
      "*.password",
      "*.authorization",
      "*.cookie",
      "*.reconnectionToken",
    ],
    censor: "[Redacted]",
  },
});
