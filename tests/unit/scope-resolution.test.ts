import { describe, expect, it } from "vitest";

import { ScopeResolver } from "../../src/modules/tenancy/scope";

describe("ScopeResolver", () => {
  const resolver = new ScopeResolver();

  it("treats broader project memory as accessible to repository queries", () => {
    expect(
      resolver.isAccessible(
        { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        { workspaceId: "w1", projectId: "p1" }
      )
    ).toBe(true);
  });

  it("rejects mismatched repository scope", () => {
    expect(
      resolver.isAccessible(
        { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        { workspaceId: "w1", projectId: "p1", repositoryId: "r2" }
      )
    ).toBe(false);
  });

  it("prefers narrower memories when calculating distance", () => {
    const exact = resolver.scopeDistance(
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1" }
    );
    const broader = resolver.scopeDistance(
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      { workspaceId: "w1", projectId: "p1" }
    );

    expect(exact).toBe(0);
    expect(broader).toBeGreaterThan(exact);
  });

  it("treats parent directory path memory as accessible to a file-scoped query", () => {
    expect(
      resolver.isAccessible(
        { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api" }
      )
    ).toBe(true);
  });

  it("prefers exact path over parent directory and repository scope", () => {
    const exact = resolver.scopeDistance(
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" }
    );
    const parent = resolver.scopeDistance(
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api" }
    );
    const repository = resolver.scopeDistance(
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      { workspaceId: "w1", projectId: "p1", repositoryId: "r1" }
    );

    expect(exact).toBe(0);
    expect(parent).toBeGreaterThan(exact);
    expect(repository).toBeGreaterThan(parent);
  });

  it("normalizes repository-relative paths and rejects parent traversal", () => {
    expect(resolver.normalizeScope({ repositoryId: "r1", path: ".\\src\\api\\server.ts" }).path).toBe("src/api/server.ts");
    expect(() => resolver.ensureScoped({ repositoryId: "r1", path: "../secrets.txt" })).toThrow("repository-relative");
  });
});
