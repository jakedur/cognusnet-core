import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { MemoryRecord, RetrieveMemoryRequest } from "../../src/domain/types";
import { DeterministicEmbeddingProvider } from "../../src/modules/embeddings/provider";
import { rankMemories } from "../../src/modules/retrieval/ranker";
import { ScopeResolver } from "../../src/modules/tenancy/scope";

async function buildMemory(partial: Partial<MemoryRecord>): Promise<MemoryRecord> {
  const embeddings = new DeterministicEmbeddingProvider();
  const title = partial.title ?? "Memory";
  const content = partial.content ?? "Fallback content";
  return {
    id: partial.id ?? randomUUID(),
    tenantId: partial.tenantId ?? "tenant-alpha",
    scopes: partial.scopes ?? { workspaceId: "w1", projectId: "p1" },
    actorId: partial.actorId ?? "actor-1",
    type: partial.type ?? "fact",
    title,
    content,
    attributes: partial.attributes ?? {},
    confidence: partial.confidence ?? 0.8,
    freshness: partial.freshness ?? 0.8,
    pinned: partial.pinned ?? false,
    stale: partial.stale ?? false,
    status: partial.status ?? "active",
    sourceIds: partial.sourceIds ?? [],
    sources: partial.sources ?? [],
    embedding: partial.embedding ?? (await embeddings.embed(`${title}\n${content}`)),
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt ?? new Date().toISOString()
  };
}

describe("rankMemories", () => {
  it("ranks exact repository matches above broader memories", async () => {
    const embeddings = new DeterministicEmbeddingProvider();
    const request: RetrieveMemoryRequest = {
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      query: "where is the auth middleware in api/server.ts",
      interactionMode: "coding"
    };

    const exact = await buildMemory({
      title: "Auth middleware location",
      content: "api/server.ts contains the auth middleware entrypoint.",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      confidence: 0.9
    });
    const broader = await buildMemory({
      title: "Architecture note",
      content: "Authentication is handled centrally.",
      scopes: { workspaceId: "w1", projectId: "p1" },
      confidence: 0.9
    });

    const ranked = rankMemories({
      request,
      queryEmbedding: await embeddings.embed(request.query),
      candidates: [broader, exact],
      scopeResolver: new ScopeResolver()
    });

    expect(ranked[0]?.memory.id).toBe(exact.id);
  });
});
