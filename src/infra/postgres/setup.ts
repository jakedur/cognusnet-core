import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

export const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/cognusnet";

export function resolveDatabaseTargets(databaseUrl: string): { adminDatabaseUrl: string; targetDatabase: string } {
  const url = new URL(databaseUrl);
  const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (!targetDatabase) {
    throw new Error(`DATABASE_URL must include a database name: ${databaseUrl}`);
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = targetDatabase === "postgres" ? "/template1" : "/postgres";
  return {
    adminDatabaseUrl: adminUrl.toString(),
    targetDatabase
  };
}

export function sortMigrationFilenames(files: string[]): string[] {
  return [...files]
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

export async function ensureDatabaseExists(databaseUrl: string): Promise<{ created: boolean; targetDatabase: string }> {
  const { adminDatabaseUrl, targetDatabase } = resolveDatabaseTargets(databaseUrl);
  const client = new Client({ connectionString: adminDatabaseUrl });

  await client.connect();

  try {
    const existing = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [targetDatabase]
    );

    if (existing.rows[0]?.exists) {
      return { created: false, targetDatabase };
    }

    await client.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
    return { created: true, targetDatabase };
  } finally {
    await client.end();
  }
}

export async function applyMigrations(databaseUrl: string, migrationsDir: string): Promise<string[]> {
  const files = sortMigrationFilenames(await readdir(migrationsDir));
  const client = new Client({ connectionString: databaseUrl });
  const applied: string[] = [];
  const lockKey = advisoryLockKey(databaseUrl);

  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const existing = await client.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [file]
      );

      if (existing.rowCount && existing.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    await client.end();
  }

  return applied;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function advisoryLockKey(value: string): number {
  let hash = 0;

  for (const char of value) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }

  return hash === 0 ? 1 : hash;
}
