import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("POST /v1/memory/feedback", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("pins an existing memory and returns an audit reference", async () => {
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

    const memory = testContext.store.snapshot().memories[0];
    if (!memory) {
      throw new Error("Expected a memory to exist after write");
    }
    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/feedback",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        memoryId: memory.id,
        action: "pin"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().memory.pinned).toBe(true);
    expect(response.json().auditReference).toContain(memory.id);
  });

  it("rejects edit feedback without replacement content", async () => {
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

    const memory = testContext.store.snapshot().memories[0];
    if (!memory) {
      throw new Error("Expected a memory to exist after write");
    }

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/feedback",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        memoryId: memory.id,
        action: "edit"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Content is required");
  });

  it("rejects feedback for a memory in another tenant", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const now = new Date().toISOString();
    testContext.store.seedMemory({
      id: randomUUID(),
      tenantId: "tenant-beta",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      actorId: "actor-2",
      type: "decision",
      title: "Shared deployment decision",
      content: "Deploy from blue-green pipeline",
      attributes: {},
      confidence: 0.91,
      freshness: 1,
      pinned: false,
      stale: false,
      status: "active",
      sourceIds: ["event-1"],
      sources: [
        {
          eventId: "event-1",
          sourceKind: "conversation",
          sourceLabel: "Seed",
          actorId: "actor-2",
          capturedAt: now
        }
      ],
      embedding: [0.2, 0.4, 0.6],
      createdAt: now,
      updatedAt: now
    });

    const betaMemory = testContext.store.snapshot().memories.find((memory) => memory.tenantId === "tenant-beta");
    if (!betaMemory) {
      throw new Error("Expected a seeded cross-tenant memory");
    }

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/feedback",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        memoryId: betaMemory.id,
        action: "pin"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("authenticated tenant");
    expect(testContext.store.snapshot().memories.find((memory) => memory.id === betaMemory.id)?.pinned).toBe(false);
  });

  it("rejects feedback when the requested scope does not match the target memory", async () => {
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

    const memory = testContext.store.snapshot().memories[0];
    if (!memory) {
      throw new Error("Expected a memory to exist after write");
    }

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/feedback",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r2" },
        memoryId: memory.id,
        action: "pin"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("requested scope");
    expect(testContext.store.snapshot().memories.find((candidate) => candidate.id === memory.id)?.pinned).toBe(false);
  });
});
