CREATE TABLE post_revisions (
 post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 version integer NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id,version)
);
-- Capture every committed version atomically with the article write, including imports.
CREATE FUNCTION record_post_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO post_revisions(post_id,version,snapshot) VALUES(NEW.id,NEW.version,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER posts_revision AFTER INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION record_post_revision();
INSERT INTO post_revisions(post_id,version,snapshot) SELECT id,version,to_jsonb(posts) FROM posts;
CREATE INDEX posts_admin_order ON posts(updated_at DESC,id DESC);
CREATE INDEX posts_tags ON posts USING gin(tags);
