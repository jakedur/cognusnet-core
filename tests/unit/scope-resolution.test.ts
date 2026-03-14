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
});
