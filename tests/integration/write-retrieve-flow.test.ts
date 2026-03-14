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

  it("prefers exact path memories and auto-repairs them with newer writes", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const write = async (answer: string, idempotencyKey: string) =>
      testContext.app.inject({
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
            answer
          },
          provenance: {
            sourceKind: "prompt_response",
            sourceLabel: "Coding session",
            actorId: testContext.actorId,
            capturedAt: new Date().toISOString()
          },
          idempotencyKey
        }
      });

    const first = await write("It lives in api/server.ts.", "path-1");
    const second = await write("It lives in src/api/server.ts.", "path-2");

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api" },
        artifactType: "documentation",
        artifactPayload: "Authentication code for the API layer lives under src/api.",
        provenance: {
          sourceKind: "documentation",
          sourceLabel: "API docs",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        },
        idempotencyKey: "path-doc-1"
      }
    });

    const retrieve = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/retrieve",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        query: "Where is the auth middleware in src/api/server.ts?",
        interactionMode: "coding"
      }
    });

    const snapshot = testContext.store.snapshot();
    expect(first.json().acceptedCount).toBe(1);
    expect(second.json().acceptedCount).toBe(1);
    expect(snapshot.memories).toHaveLength(2);
    expect(retrieve.json().memoryRecords[0].memory.content).toContain("src/api/server.ts");
    expect(retrieve.json().memoryRecords[1].memory.content).toContain("src/api");
    expect(retrieve.json().trace.selectedMatches[0].pathMatch).toBe("exact");
    expect(retrieve.json().trace.selectedMatches[1].pathMatch).toBe("ancestor");
  });
});
