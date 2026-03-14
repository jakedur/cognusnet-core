ALTER TABLE raw_events
  ADD COLUMN IF NOT EXISTS path TEXT;

ALTER TABLE memory_records
  ADD COLUMN IF NOT EXISTS path TEXT;

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS path TEXT;

CREATE INDEX IF NOT EXISTS memory_records_tenant_scope_path_idx
  ON memory_records (tenant_id, workspace_id, project_id, repository_id, path, user_private_id);
