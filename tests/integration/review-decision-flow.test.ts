import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("review decision flow", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("changes retrieval results after a queued item is accepted", async () => {
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
        artifactType: "prompt_response",
        artifactPayload: {
          query: "Where is the auth middleware?",
          answer: "The auth middleware lives in api/server.ts."
        },
        provenance: {
          sourceKind: "prompt_response",
          sourceLabel: "Control plane",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const reviewId = testContext.store.snapshot().reviews[0]?.id;
    await testContext.app.inject({
      method: "POST",
      url: `/v1/review/items/${reviewId}/decision`,
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        action: "accept"
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

    expect(retrieve.statusCode).toBe(200);
    expect(retrieve.json().memoryRecords).toHaveLength(1);
    expect(retrieve.json().memoryRecords[0].memory.content).toContain("api/server.ts");
  });
});
