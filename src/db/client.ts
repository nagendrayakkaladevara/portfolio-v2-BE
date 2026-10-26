import pg from "pg";
import type { Env } from "../config/env.js";
export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
export function createPool(env: Env, direct = false) {
  const connection = new URL(
    direct ? (env.DATABASE_DIRECT_URL ?? env.DATABASE_URL) : env.DATABASE_URL,
  );
  // Prevent connection-string SSL parameters from overriding certificate verification.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    connection.searchParams.delete(key);
  return new pg.Pool({
    connectionString: connection.toString(),
    ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });
}
