# Implemented API · v1

All endpoints use `/api/v1` except health. All write bodies are strict JSON. Unknown fields are rejected. Errors use `application/problem+json` with `type`, `title`, `status`, `detail`, `requestId`; no SQL, stack, token or request-body echo. All dates are UTC ISO 8601. Public collection limit defaults to 20, maximum 50. Use returned cursors unchanged.

| Method | Route | Authentication | Behavior |
|---|---|---|---|
| GET | `/health/live` | None | Liveness `{status:"ok"}` |
| GET | `/health/ready` | None | Verifies posts and revision tables exist; readiness |
| GET | `/posts?limit=20&cursor=...` | None | Published summaries and cursor pagination |
| GET | `/tags` | None | Tags and counts from published articles only |
| GET | `/admin/session` | Owner JWT | Owner subject and storage availability |
| GET | `/admin/posts?status=draft&q=angular&limit=20` | Owner JWT | All article statuses, search, tag filter and cursor pagination |
| GET | `/admin/posts/:id/revisions?limit=20&cursor=...` | Owner JWT | Version snapshots, newest first, paginated |
| GET | `/posts/:slug` | None | Published article with Markdown and media |
| POST | `/admin/posts` | Owner JWT | Create draft/published article; 201 and ETag |
| GET | `/admin/posts/:id` | Owner JWT | Read any status; ETag |
| PUT | `/admin/posts/:id` | Owner JWT + If-Match | Full replacement; version increments; 412 if stale |
| POST | `/admin/media/uploads` | Owner JWT | Create private presigned PUT URL; 201 |
| POST | `/admin/media/:id/complete` | Owner JWT | Verify/re-encode/publish image |
| GET | `/chat/config` | None | Current `enabled:false` configuration |
| POST | `/chat/sessions` | None | Mint 60-minute anonymous capability; 201 |
| GET | `/chat/sessions/:id` | Session bearer | Current empty history contract |
| DELETE | `/chat/sessions/:id` | Session bearer | Delete/revoke session; 204 |
| POST | `/chat/sessions/:id/messages` | Session bearer | Validate request; 503 until AI integration |

Post write example:

```json
{"slug":"building-useful-interfaces","title":"Building useful interfaces","excerpt":"Notes from practice.","bodyMarkdown":"# An idea\n\nWrite the article here.","tags":[{"slug":"react","name":"React"}],"mediaIds":[],"coverImageId":null,"isDemo":false,"status":"draft"}
```

Status: `draft | published | archived`. To publish or unpublish, PUT the complete write object with the new status and `If-Match: "1"` (use the latest GET ETag). Publishing sets the first publication timestamp. Archived/draft records return 404 publicly. Slugs are lowercase words/digits separated by hyphens. Existing slugs can change, but redirect creation is not implemented; avoid changing published slugs until redirects are added. A slug collision returns 409. Missing If-Match is 428; stale version is 412. Owner write results are `{data:{...article,status,mediaIds,coverImageId}}`, with draft `publishedAt:null`.

Public article:

```json
{"data":{"id":"8318a34f-1484-4eb8-8ab1-b3a1378a2d8c","slug":"building-useful-interfaces","title":"Building useful interfaces","excerpt":"Notes from practice.","publishedAt":"2026-10-08T00:00:00.000Z","updatedAt":"2026-10-08T00:00:00.000Z","readingTimeMinutes":1,"tags":[{"slug":"react","name":"React"}],"coverImage":null,"isDemo":false,"bodyMarkdown":"# An idea\n\nWrite the article here.","media":[]}}
```

List `{data:[...summaries],pagination:{limit:20,hasMore:false,nextCursor:null}}`; summary excludes `bodyMarkdown` and `media`. Media entries: `{id,url,alt,width,height,caption:null}`. Source files must be finalized before media IDs can be attached to a post. Draft article visibility does not make already-finalized media private: finalization deliberately publishes its rendition. Use this only for public portfolio images; private draft-media publication workflows remain future work.

Upload request: `{contentType:"image/png",sizeBytes:125000,alt:"Diagram explaining the design"}`. Response `{data:{id,uploadUrl,method:"PUT",headers:{"Content-Type":"image/png"},expiresInSeconds:300}}`. PUT exactly those bytes/type to the URL, then POST `{}` to `/admin/media/:id/complete`. Response `{data:{id,url,width,height}}`. No presigned URL is logged or persisted. Processing is claimed atomically; repeated/expired/in-progress finalization returns 409. Failure marks upload failed; request a new upload. Finalization has multiple external steps rather than a distributed transaction: monitor/reconcile rare public-orphan objects after a process crash and expire original uploads using R2 lifecycle.

Chat session POST body `{}`; response `{data:{id,token,expiresAt}}`. Token is returned once, 256 random bits, stored server-side only as SHA-256, and sent subsequently as `Authorization: Bearer <token>`. Tokens never go in a URL or browser persistent storage. Invalid/missing/expired session returns 401. DELETE revokes the capability; repeated delete returns 401 (frontend treats expired/revoked state through its session recovery flow). No transcripts are stored before AI integration.

Message body `{clientMessageId:"uuid",content:"Tell me about Sai",pagePath:"/"}`; content 1–2000 trimmed characters, no unsafe controls. Paths local, maximum 240, no query/fragment. Current response is 503 Problem Details, never fake model output.

Rate limits: 120 API requests/minute/IP; 30 admin requests/minute/IP; 10 media requests/minute/IP; 5 session creations/hour/IP; 10 message requests/minute/IP. Counters are shared PostgreSQL rows with HMAC identifiers. IP addresses are not stored as raw counter keys. Limits fail closed on database failure. Responses expose standardized rate headers and 429/Retry-After. Apply edge limits before the database for hostile traffic. IPv6 subnet handling uses express-rate-limit defaults.

These contracts supersede the corresponding earlier .NET design for implemented routes. Earlier planned admin cookie/CSRF contracts are replaced here by owner OIDC bearer validation. The wider CMS specification remains a roadmap, not implemented API documentation.

## Studio additions

Public `/posts` supports optional `q` (case-insensitive literal title/excerpt substring, 120 characters) and `tag` (tag slug, 60 characters). Wildcards have no special meaning. `/tags` returns `{data:[{slug,name,count}]}` and never includes drafts, archives or future articles.

`GET /admin/posts` uses the same filters and an optional `status`, sorting by last update and UUID. Every summary includes `status` and `version`; draft publication dates can be null. Owner cursors refer to update timestamps and must not be reused for public pagination.

Revision rows are `{version,snapshot,createdAt}`. `snapshot` contains database column names (for example `body_markdown`, `media_ids`); revisions are private and cache-disabled. A trigger captures the full committed article version in the same transaction as every insert/update. Failed optimistic writes create no revision. This includes the current version and imported drafts; migration 002 backfills existing current versions. Historical media URLs are not reconstructed by this endpoint. The cursor is the exclusive upper version bound; the limit defaults to 20 and is capped at 50.
