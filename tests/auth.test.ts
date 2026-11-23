import { beforeAll, it, expect, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import express from "express";
import request from "supertest";
import { ownerAuth } from "../src/middleware/auth.js";
import { errorHandler } from "../src/shared/errors.js";
import { parseEnv } from "../src/config/env.js";
const state = vi.hoisted(() => ({ resolve: undefined as unknown }));
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: () => state.resolve };
});
let privateKey: CryptoKey;
const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  DATABASE_SSL: "false",
  RATE_LIMIT_SECRET: "a".repeat(32),
  AUTH_ISSUER: "https://identity.example/",
  AUTH_AUDIENCE: "portfolio-api",
  AUTH_JWKS_URL: "https://identity.example/jwks",
  AUTH_OWNER_SUBJECTS: "owner-123",
});
let app: ReturnType<typeof express>;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  state.resolve = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test-key" }],
  });
  app = express();
  app.get("/owner", ownerAuth(env), (_req, res) =>
    res.json({ owner: res.locals.owner }),
  );
  app.use(errorHandler);
});
async function token(
  subject = "owner-123",
  audience = "portfolio-api",
  expiration = "5m",
  issuer = "https://identity.example/",
) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}
it("accepts signed owner access tokens", async () => {
  const r = await request(app)
    .get("/owner")
    .set("Authorization", `Bearer ${await token()}`)
    .expect(200);
  expect(r.body.owner).toBe("owner-123");
});
it("rejects non-owner subjects despite valid signatures", async () => {
  await request(app)
    .get("/owner")
    .set("Authorization", `Bearer ${await token("visitor")}`)
    .expect(403);
});
it("rejects wrong audience, issuer, expired and tampered tokens", async () => {
  for (const t of [
    await token("owner-123", "other-api"),
    await token("owner-123", "portfolio-api", "-1h"),
    await token("owner-123", "portfolio-api", "5m", "https://evil.example/"),
    (await token()).slice(0, -10) + "tampered",
  ])
    await request(app)
      .get("/owner")
      .set("Authorization", `Bearer ${t}`)
      .expect(401);
});
