import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("initial schema", () => {
  const migration = readFileSync(
    join(process.cwd(), "src", "infra", "postgres", "migrations", "001_init.sql"),
    "utf8"
  );

  it("creates required extensions and tables", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector;");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS raw_events");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS memory_records");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS review_queue");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS audit_logs");
  });

  it("includes idempotency and retrieval indexes", () => {
    expect(migration).toContain("raw_events_tenant_idempotency_idx");
    expect(migration).toContain("memory_records_tenant_scope_idx");
    expect(migration).toContain("memory_records_embedding_idx");
  });
});
