import { createRemoteJWKSet, jwtVerify } from "jose";
import type { RequestHandler } from "express";
import type { Env } from "../config/env.js";
import { HttpError } from "../shared/errors.js";
export function ownerAuth(env: Env): RequestHandler {
  const jwks = env.AUTH_JWKS_URL
    ? createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
      })
    : null;
  const subjects = new Set(
    env.AUTH_OWNER_SUBJECTS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return async (req, res, next) => {
    if (!jwks)
      throw new HttpError(
        503,
        "admin_not_configured",
        "Owner authentication is not configured.",
      );
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? "");
    if (!match || match[1]!.length > 8192)
      throw new HttpError(
        401,
        "unauthorized",
        "A valid owner access token is required.",
      );
    try {
      const { payload } = await jwtVerify(match[1]!, jwks, {
        issuer: env.AUTH_ISSUER,
        audience: env.AUTH_AUDIENCE,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["exp", "iat", "sub"],
        clockTolerance: 5,
      });
      if (!payload.sub || !subjects.has(payload.sub))
        throw new HttpError(403, "forbidden", "Owner access required.");
      res.locals.owner = payload.sub;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        401,
        "unauthorized",
        "A valid owner access token is required.",
      );
    }
    next();
  };
}
