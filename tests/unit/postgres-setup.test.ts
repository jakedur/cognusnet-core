import { describe, expect, it } from "vitest";

import { resolveDatabaseTargets, sortMigrationFilenames } from "../../src/infra/postgres/setup";

describe("postgres setup helpers", () => {
  it("derives the admin database url from the target database url", () => {
    expect(resolveDatabaseTargets("postgres://postgres:postgres@localhost:5432/cognusnet")).toEqual({
      adminDatabaseUrl: "postgres://postgres:postgres@localhost:5432/postgres",
      targetDatabase: "cognusnet"
    });
  });

  it("falls back to template1 when the target database is already postgres", () => {
    expect(resolveDatabaseTargets("postgres://postgres:postgres@localhost:5432/postgres")).toEqual({
      adminDatabaseUrl: "postgres://postgres:postgres@localhost:5432/template1",
      targetDatabase: "postgres"
    });
  });

  it("sorts only sql migration files", () => {
    expect(sortMigrationFilenames(["003_notes.txt", "002_path_scope.sql", "001_init.sql"])).toEqual([
      "001_init.sql",
      "002_path_scope.sql"
    ]);
  });
});
