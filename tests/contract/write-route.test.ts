import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("POST /v1/memory/write", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("writes an event and promotes high confidence memories", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: {
        "x-api-key": testContext.apiKey
      },
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
        },
        idempotencyKey: "event-1"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.acceptedCount).toBe(1);
    expect(body.queuedCount).toBe(0);
    expect(testContext.store.snapshot().memories).toHaveLength(1);
  });

  it("deduplicates writes by idempotency key", async () => {
    const testContext = createTestContext();
    app = testContext.app;
    const payload = {
      tenantId: testContext.tenantId,
      actorId: testContext.actorId,
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      artifactType: "conversation",
      artifactPayload: "Decision: use pgvector for embeddings",
      provenance: {
        sourceKind: "conversation",
        sourceLabel: "Architecture review",
        actorId: testContext.actorId,
        capturedAt: new Date().toISOString()
      },
      idempotencyKey: "event-2"
    };

    const first = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload
    });
    const second = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload
    });

    expect(first.json().extractionStatus).toBe("processed");
    expect(second.json().extractionStatus).toBe("duplicate");
    expect(testContext.store.snapshot().rawEvents).toHaveLength(1);
  });

  it("accepts an optional repository-relative path for coding writes", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: ".\\src\\api\\server.ts" },
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
        },
        idempotencyKey: "event-path-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(testContext.store.snapshot().rawEvents[0]?.scopes.path).toBe("src/api/server.ts");
    expect(testContext.store.snapshot().memories[0]?.scopes.path).toBe("src/api/server.ts");
  });

  it("stores coding intent as repository-scoped memory while preserving origin path metadata", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: testContext.tenantId,
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "scripts/demo.py" },
        artifactType: "coding_intent",
        artifactPayload: {
          task: "Print ahhh",
          rationale: "because the sky is blue",
          constraints: ["single print statement"]
        },
        provenance: {
          sourceKind: "coding_intent",
          sourceLabel: "Coding intent",
          actorId: testContext.actorId,
          capturedAt: new Date().toISOString()
        },
        idempotencyKey: "event-intent-1"
      }
    });

    expect(response.statusCode).toBe(200);
    const snapshot = testContext.store.snapshot();
    expect(snapshot.rawEvents[0]?.scopes.path).toBe("scripts/demo.py");
    expect(snapshot.memories[0]?.scopes).toEqual({
      workspaceId: "w1",
      projectId: "p1",
      repositoryId: "r1"
    });
    expect(snapshot.memories[0]?.attributes.originPath).toBe("scripts/demo.py");
    expect(snapshot.memories[0]?.type).toBe("operational_note");
  });
});
