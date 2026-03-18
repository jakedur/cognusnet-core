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
    expect(body.contextBlock).toContain("Path match:");
    expect(body.contextBlock).not.toContain("Memory 1:");
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

  it("dedupes same-query coding memories by merge key and keeps the narrowest ranked answer", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const commonPayload = {
      tenantId: testContext.tenantId,
      actorId: testContext.actorId,
      artifactType: "prompt_response" as const,
      provenance: {
        sourceKind: "prompt_response" as const,
        sourceLabel: "Coding session",
        actorId: testContext.actorId,
        capturedAt: new Date().toISOString()
      }
    };

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        ...commonPayload,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        artifactPayload: {
          query: "Which file actually contains the auth middleware for the API server entrypoint?",
          answer: "The auth middleware lives in src/api/index.ts at the repository level."
        }
      }
    });

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        ...commonPayload,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        artifactPayload: {
          query: "Which file actually contains the auth middleware for the API server entrypoint?",
          answer: "The auth middleware lives in src/api/server.ts."
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
        query: "Which file actually contains the auth middleware for the API server entrypoint?",
        interactionMode: "coding"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memoryRecords).toHaveLength(1);
    expect(body.memoryRecords[0].memory.content).toContain("src/api/server.ts");
    expect(body.trace.selectedMatches[0].pathMatch).toBe("exact");
  });

  it("does not apply merge-key dedupe outside coding retrieval", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const commonPayload = {
      tenantId: testContext.tenantId,
      actorId: testContext.actorId,
      artifactType: "prompt_response" as const,
      provenance: {
        sourceKind: "prompt_response" as const,
        sourceLabel: "Support session",
        actorId: testContext.actorId,
        capturedAt: new Date().toISOString()
      }
    };

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        ...commonPayload,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
        artifactPayload: {
          query: "How is auth configured?",
          answer: "Repository-level auth is configured through src/api/server.ts."
        }
      }
    });

    await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/write",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        ...commonPayload,
        scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
        artifactPayload: {
          query: "How is auth configured?",
          answer: "File-level auth is configured in src/api/server.ts."
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
        query: "How is auth configured?",
        interactionMode: "support"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().memoryRecords).toHaveLength(2);
  });
});
