import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("initial schema", () => {
  const initialMigration = readFileSync(
    join(process.cwd(), "src", "infra", "postgres", "migrations", "001_init.sql"),
    "utf8"
  );
  const pathMigration = readFileSync(
    join(process.cwd(), "src", "infra", "postgres", "migrations", "002_path_scope.sql"),
    "utf8"
  );

  it("creates required extensions and tables", () => {
    expect(initialMigration).toContain("CREATE EXTENSION IF NOT EXISTS vector;");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS raw_events");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS memory_records");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS review_queue");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS audit_logs");
  });

  it("includes idempotency and retrieval indexes", () => {
    expect(initialMigration).toContain("raw_events_tenant_idempotency_idx");
    expect(initialMigration).toContain("memory_records_tenant_scope_idx");
    expect(initialMigration).toContain("memory_records_embedding_idx");
  });

  it("adds path-aware scope columns and indexes in a follow-up migration", () => {
    expect(pathMigration).toContain("ALTER TABLE raw_events");
    expect(pathMigration).toContain("ADD COLUMN IF NOT EXISTS path TEXT");
    expect(pathMigration).toContain("ALTER TABLE memory_records");
    expect(pathMigration).toContain("ALTER TABLE review_queue");
    expect(pathMigration).toContain("memory_records_tenant_scope_path_idx");
  });
});
