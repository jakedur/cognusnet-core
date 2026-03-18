import path from "node:path";

import {
  applyMigrations,
  DEFAULT_DATABASE_URL,
  ensureDatabaseExists
} from "../infra/postgres/setup";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "setup";
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const migrationsDir = path.resolve(__dirname, "../infra/postgres/migrations");

  if (command === "create") {
    const result = await ensureDatabaseExists(databaseUrl);
    console.log(result.created ? `Created database ${result.targetDatabase}.` : `Database ${result.targetDatabase} already exists.`);
    return;
  }

  if (command === "migrate") {
    const files = await applyMigrations(databaseUrl, migrationsDir);
    console.log(`Applied ${files.length} new migration${files.length === 1 ? "" : "s"} to ${databaseUrl}.`);
    return;
  }

  if (command === "setup") {
    const result = await ensureDatabaseExists(databaseUrl);
    console.log(result.created ? `Created database ${result.targetDatabase}.` : `Database ${result.targetDatabase} already exists.`);
    const files = await applyMigrations(databaseUrl, migrationsDir);
    console.log(`Applied ${files.length} new migration${files.length === 1 ? "" : "s"} to ${result.targetDatabase}.`);
    return;
  }

  throw new Error(`Unknown command "${command}". Use one of: create, migrate, setup.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
