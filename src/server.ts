import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createPool } from "./db/client.js";
import pino from "pino";
const log = pino();
const result = (() => {
  try {
    return parseEnv(process.env);
  } catch {
    log.fatal(
      "Invalid environment configuration. Check env.example; secret values are not logged.",
    );
    process.exit(1);
  }
})();
const db = createPool(result);
db.on("error", () => log.error("Database pool error"));
const app = createApp({ db, env: result });
const server = app.listen(result.PORT, () =>
  log.info({ port: result.PORT }, "Portfolio API listening"),
);
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 1000;
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  server.close(() => {
    void db.end().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
