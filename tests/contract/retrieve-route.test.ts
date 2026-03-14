import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("POST /v1/memory/retrieve", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns prompt-ready context and ranked memories", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        artifactType: "conversation",
        artifactPayload: "Decision: auth middleware lives in api/server.ts",
        provenance: {
          sourceKind: "conversation",
          sourceLabel: "Design sync",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/retrieve",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        query: "Where is the auth middleware?",
        interactionMode: "coding"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memoryRecords).toHaveLength(1);
    expect(body.contextBlock).toContain("api/server.ts");
  });

  it("returns path-aware trace metadata for file-scoped coding queries", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        artifactType: "prompt_response",
        artifactPayload: {
          query: "Where is the auth middleware?",
          answer: "It lives in src/api/server.ts."
        },
        provenance: {
          sourceKind: "prompt_response",
          sourceLabel: "Coding session",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/retrieve",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        query: "Where is the auth middleware?",
        interactionMode: "coding"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().trace.selectedMatches[0].pathMatch).toBe("exact");
  });
});
