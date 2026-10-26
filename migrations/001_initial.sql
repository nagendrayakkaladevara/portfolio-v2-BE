CREATE TABLE posts (
 id uuid PRIMARY KEY, slug varchar(120) UNIQUE NOT NULL, title varchar(160) NOT NULL, excerpt varchar(320) NOT NULL,
 body_markdown text NOT NULL CHECK(length(body_markdown)<=200000), tags jsonb NOT NULL DEFAULT '[]',
 media_ids uuid[] NOT NULL DEFAULT '{}', cover_image_id uuid, is_demo boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX posts_public_order ON posts(published_at DESC,id DESC) WHERE status='published';
CREATE TABLE media (
 id uuid PRIMARY KEY, object_key text UNIQUE NOT NULL, content_type text NOT NULL, expected_bytes integer NOT NULL CHECK(expected_bytes BETWEEN 1 AND 5242880),
 alt varchar(250) NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','failed')),
 public_key text, width integer, height integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (key text PRIMARY KEY,hits integer NOT NULL,reset_at timestamptz NOT NULL);
CREATE INDEX rate_expiry ON rate_limits(reset_at);
CREATE TABLE chat_sessions (id uuid PRIMARY KEY,token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX chat_expiry ON chat_sessions(expires_at);
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor text NOT NULL,action text NOT NULL,resource_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
