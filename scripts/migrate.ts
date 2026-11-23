import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createPool } from "../src/db/client.js";
import { parseEnv } from "../src/config/env.js";
const pool = createPool(parseEnv(process.env), true);
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(73928012)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const { rows } = await client.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (rows.length) {
      if (rows[0].checksum !== checksum)
        throw Error(`Migration checksum changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(73928012)");
  client.release();
  await pool.end();
}
