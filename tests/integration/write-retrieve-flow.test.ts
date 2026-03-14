import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("write -> retrieve flow", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("queues ambiguous summaries for review and retrieves durable memories", async () => {
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
        artifactPayload: "We talked about cleanup work for the repo.",
        provenance: {
          sourceKind: "conversation",
          sourceLabel: "Standup",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

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

    const retrieve = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/retrieve",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        query: "auth middleware",
        interactionMode: "coding"
      }
    });

    const snapshot = testContext.store.snapshot();
    expect(snapshot.reviews).toHaveLength(1);
    expect(snapshot.memories).toHaveLength(1);
    expect(retrieve.json().memoryRecords[0].memory.content).toContain("api/server.ts");
  });
});
