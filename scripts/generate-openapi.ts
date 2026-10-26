import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { postWrite } from "../src/modules/posts/schema.js";
import { uploadSchema } from "../src/modules/media/routes.js";
import { messageSchema } from "../src/modules/chat/routes.js";
const schemas = {
  PostWrite: z.toJSONSchema(postWrite),
  UploadWrite: z.toJSONSchema(uploadSchema),
  MessageWrite: z.toJSONSchema(messageSchema),
  Problem: {
    type: "object",
    required: ["type", "title", "status", "detail"],
    properties: {
      type: { type: "string" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      requestId: { type: "string" },
    },
  },
};
const paths: Record<string, Record<string, unknown>> = {};
const specs: [string, string, string, string?, string?][] = [
  ["/health/live", "get", "Liveness"],
  ["/health/ready", "get", "Database readiness"],
  ["/api/v1/posts", "get", "Published articles"],
  ["/api/v1/tags", "get", "Published article tags"],
  [
    "/api/v1/admin/session",
    "get",
    "Owner access and storage availability",
    "owner",
  ],
  ["/api/v1/admin/posts", "get", "Owner article listing", "owner"],
  [
    "/api/v1/admin/posts/{id}/revisions",
    "get",
    "Owner article revisions",
    "owner",
  ],
  ["/api/v1/posts/{slug}", "get", "Published article"],
  ["/api/v1/admin/posts", "post", "Create article", "owner", "PostWrite"],
  ["/api/v1/admin/posts/{id}", "get", "Read editable article", "owner"],
  ["/api/v1/admin/posts/{id}", "put", "Replace article", "owner", "PostWrite"],
  [
    "/api/v1/admin/media/uploads",
    "post",
    "Create signed R2 upload",
    "owner",
    "UploadWrite",
  ],
  [
    "/api/v1/admin/media/{id}/complete",
    "post",
    "Verify and publish image",
    "owner",
  ],
  ["/api/v1/chat/config", "get", "Disabled AI Agent configuration"],
  ["/api/v1/chat/sessions", "post", "Create capability session"],
  ["/api/v1/chat/sessions/{id}", "get", "Read session", "session"],
  ["/api/v1/chat/sessions/{id}", "delete", "Revoke session", "session"],
  [
    "/api/v1/chat/sessions/{id}/messages",
    "post",
    "AI provider not configured; returns 503",
    "session",
    "MessageWrite",
  ],
];
for (const [path, method, summary, auth, body] of specs) {
  const parameters: unknown[] = [];
  for (const parameter of path.matchAll(/\{(\w+)\}/g))
    parameters.push({
      in: "path",
      name: parameter[1],
      required: true,
      schema: {
        type: "string",
        ...(parameter[1] === "id" ? { format: "uuid" } : {}),
      },
    });
  if (
    method === "get" &&
    (path === "/api/v1/posts" ||
      path === "/api/v1/admin/posts" ||
      path.endsWith("/revisions"))
  )
    parameters.push(
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      {
        in: "query",
        name: "cursor",
        schema: { type: "string", maxLength: 500 },
      },
    );
  if (
    method === "get" &&
    (path === "/api/v1/posts" || path === "/api/v1/admin/posts")
  ) {
    parameters.push(
      { in: "query", name: "q", schema: { type: "string", maxLength: 120 } },
      { in: "query", name: "tag", schema: { type: "string", maxLength: 60 } },
    );
    if (path.includes("/admin/"))
      parameters.push({
        in: "query",
        name: "status",
        schema: { type: "string", enum: ["draft", "published", "archived"] },
      });
  }
  if (method === "put")
    parameters.push({
      in: "header",
      name: "If-Match",
      required: true,
      schema: { type: "string", example: '"1"' },
    });
  const pending = path.endsWith("/messages");
  const status =
    method === "delete"
      ? "204"
      : method === "post" && !path.endsWith("/complete")
        ? "201"
        : "200";
  const operation: Record<string, unknown> = {
    summary,
    parameters,
    security: auth
      ? [{ [auth === "owner" ? "OwnerBearer" : "ChatSessionToken"]: [] }]
      : [],
    responses: {
      ...(pending
        ? {}
        : {
            [status]: {
              description:
                "See API.md for the complete response field contract.",
            },
          }),
      default: {
        description:
          "Problem Details; see API.md for status-specific behavior.",
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
      },
    },
  };
  if (pending)
    (operation.responses as Record<string, unknown>)["503"] = {
      description: "ai_not_configured. No model invocation or SSE stream yet.",
    };
  if (body)
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${body}` },
        },
      },
    };
  else if (method === "post")
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: false },
        },
      },
    };
  (paths[path] ??= {})[method] = operation;
}
await writeFile(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Portfolio API — implemented routes",
        version: "1.0.0",
        description:
          "Current runtime routes and request schemas. Full response examples and status semantics in API.md. AI provider deferred.",
      },
      servers: [{ url: "http://localhost:3001" }],
      paths,
      components: {
        schemas,
        securitySchemes: {
          OwnerBearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          ChatSessionToken: {
            type: "http",
            scheme: "bearer",
            description: "Opaque 256-bit capability; not an owner JWT",
          },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
