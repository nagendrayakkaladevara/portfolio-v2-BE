import { parseEnv } from "../src/config/env.js";
// Report names only: environment errors must never echo credentials or connection URLs.
const result = (() => {
  try {
    return { env: parseEnv(process.env) };
  } catch {
    return null;
  }
})();
if (!result) {
  console.error(
    "Invalid core configuration. Check DATABASE_URL, RATE_LIMIT_SECRET, TLS and origins in env.example.",
  );
  process.exitCode = 1;
} else {
  const { env } = result;
  const checks = {
    database: Boolean(env.DATABASE_URL),
    directMigrationConnection: Boolean(env.DATABASE_DIRECT_URL),
    ownerAuthentication: Boolean(env.AUTH_ISSUER),
    imageStorage: Boolean(env.R2_ACCOUNT_ID),
    productionTls: env.DATABASE_SSL === "true",
  };
  for (const [name, ready] of Object.entries(checks))
    console.log(`${name}: ${ready ? "configured" : "missing"}`);
  console.log("AI: awaiting the owner's endpoint specification");
  if (
    !checks.ownerAuthentication ||
    !checks.imageStorage ||
    (env.NODE_ENV === "production" && !checks.directMigrationConnection)
  )
    process.exitCode = 1;
}
