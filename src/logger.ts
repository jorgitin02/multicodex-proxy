import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "accessToken",
      "refreshToken",
      "*.accessToken",
      "*.refreshToken",
      "req.headers.authorization",
      "headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});
