import { createPool } from "../src/db/client.js";
import { parseEnv } from "../src/config/env.js";
const db = createPool(parseEnv(process.env));
try {
  await db.query("DELETE FROM rate_limits WHERE reset_at<NOW()");
  await db.query("DELETE FROM chat_sessions WHERE expires_at<NOW()");
  await db.query(
    "UPDATE media SET status='failed' WHERE status IN ('pending','processing') AND created_at<NOW()-INTERVAL '1 hour'",
  );
  await db.query(
    "DELETE FROM audit_events WHERE created_at<NOW()-INTERVAL '90 days'",
  );
} finally {
  await db.end();
}
