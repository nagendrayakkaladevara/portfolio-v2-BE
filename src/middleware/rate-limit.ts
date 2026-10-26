import { createHmac } from "node:crypto";
import { rateLimit, type Store, type Options } from "express-rate-limit";
import type { Database } from "../db/client.js";
/** Atomic shared fixed windows; no process-local bypass when replicas scale. */
export class PostgresRateStore implements Store {
  private windowMs = 60000;
  localKeys = false;
  constructor(
    private db: Database,
    private namespace: string,
    private secret: string,
  ) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private key(key: string) {
    return createHmac("sha256", this.secret)
      .update(`${this.namespace}:${key}`)
      .digest("hex");
  }
  async increment(key: string) {
    const { rows } = await this.db.query<{ hits: number; reset_at: Date }>(
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,NOW()+$2*INTERVAL '1 millisecond')
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=NOW() THEN 1 ELSE rate_limits.hits+1 END,
      reset_at=CASE WHEN rate_limits.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING hits,reset_at`,
      [this.key(key), this.windowMs],
    );
    return { totalHits: rows[0]!.hits, resetTime: new Date(rows[0]!.reset_at) };
  }
  async decrement(key: string) {
    await this.db.query(
      "UPDATE rate_limits SET hits=GREATEST(0,hits-1) WHERE key=$1",
      [this.key(key)],
    );
  }
  async resetKey(key: string) {
    await this.db.query("DELETE FROM rate_limits WHERE key=$1", [
      this.key(key),
    ]);
  }
}
export const limiter = (store: Store, limit: number, windowMs = 60000) =>
  rateLimit({
    store,
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: false,
    handler: (_req, res) => {
      res
        .status(429)
        .type("application/problem+json")
        .json({
          type: "urn:portfolio:error:rate_limited",
          title: "rate_limited",
          status: 429,
          detail: "Too many requests. Try again later.",
          requestId: res.locals.requestId,
        });
    },
  });
