-- Purchase attachments were stored on local disk, which is wiped on every
-- Railway redeploy (no persistent volume). Store the file bytes in Postgres
-- instead so they survive deploys; file_path/file_name are kept only for
-- any pre-existing rows uploaded before this change (their disk files are
-- already gone and cannot be recovered).
ALTER TABLE purchase_attachments ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE purchase_attachments ALTER COLUMN file_path DROP NOT NULL;
