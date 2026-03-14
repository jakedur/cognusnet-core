import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("review routes", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("lists pending review items for a scoped tenant request", async () => {
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
        artifactPayload: "We talked about how auth might work in the server layer.",
        provenance: {
          sourceKind: "conversation",
          sourceLabel: "Control plane",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const response = await testContext.app.inject({
      method: "GET",
      url: "/v1/review/items?tenantId=tenant-alpha&actorId=actor-1&workspaceId=w1&projectId=p1&repositoryId=r1",
      headers: { "x-api-key": testContext.apiKey }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reviewItems).toHaveLength(1);
    expect(response.json().reviewItems[0].reason).toBe("low_confidence");
  });

  it("accepts a pending review item and promotes it to memory", async () => {
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
        artifactPayload: "We talked about how auth might work in the server layer.",
        provenance: {
          sourceKind: "conversation",
          sourceLabel: "Control plane",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const reviewId = testContext.store.snapshot().reviews[0]?.id;
    const response = await testContext.app.inject({
      method: "POST",
      url: `/v1/review/items/${reviewId}/decision`,
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        action: "edit_and_accept",
        content: "The auth middleware lives in api/server.ts."
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reviewItem.status).toBe("accepted");
    expect(response.json().promotedMemoryId).toBeTruthy();
    expect(testContext.store.snapshot().memories).toHaveLength(1);
  });

  it("normalizes path-scoped review list and decision requests", async () => {
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
        artifactType: "conversation",
        artifactPayload: "We talked about how auth might work in the server layer.",
        provenance: {
          sourceKind: "conversation",
          sourceLabel: "Control plane",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        }
      }
    });

    const reviewId = testContext.store.snapshot().reviews[0]?.id;
    const normalizedPath = encodeURIComponent(".\\src\\api\\server.ts");

    const listResponse = await testContext.app.inject({
      method: "GET",
      url: `/v1/review/items?tenantId=tenant-alpha&actorId=actor-1&workspaceId=w1&projectId=p1&repositoryId=r1&path=${normalizedPath}`,
      headers: { "x-api-key": testContext.apiKey }
    });

    const decisionResponse = await testContext.app.inject({
      method: "POST",
      url: `/v1/review/items/${reviewId}/decision`,
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: ".\\src\\api\\server.ts" },
        action: "edit_and_accept",
        content: "The auth middleware lives in api/server.ts."
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().reviewItems).toHaveLength(1);
    expect(decisionResponse.statusCode).toBe(200);
    expect(decisionResponse.json().reviewItem.status).toBe("accepted");
  });
});
