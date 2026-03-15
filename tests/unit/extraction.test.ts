import { describe, expect, it } from "vitest";

import type { MemoryRecord, RawEvent, ReviewItem } from "../../src/domain/types";
import { ExtractionService } from "../../src/modules/extraction/service";
import { DeterministicEmbeddingProvider } from "../../src/modules/embeddings/provider";
import { MemoryService } from "../../src/modules/memory/service";
import { ScopeResolver } from "../../src/modules/tenancy/scope";
import type { MemoryRepository, ReviewQueueRepository } from "../../src/ports/repositories";

const baseEvent = (overrides: Partial<RawEvent>): RawEvent => ({
  id: overrides.id ?? "event-default",
  tenantId: "tenant-alpha",
  scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", ...(overrides.scopes ?? {}) },
  actorId: "actor-1",
  artifactType: overrides.artifactType ?? "conversation",
  artifactPayload: overrides.artifactPayload ?? "",
  normalizedText: overrides.normalizedText ?? "",
  provenance: {
    sourceKind: overrides.provenance?.sourceKind ?? (overrides.artifactType ?? "conversation"),
    sourceLabel: overrides.provenance?.sourceLabel ?? "Test source",
    actorId: "actor-1",
    capturedAt: new Date().toISOString(),
    ...(overrides.provenance ?? {})
  },
  createdAt: new Date().toISOString(),
  ...overrides
});

describe("ExtractionService", () => {
  const extraction = new ExtractionService();

  it("promotes explicit decisions at high confidence with explicit evidence", () => {
    const event = baseEvent({
      id: "event-1",
      artifactType: "conversation",
      artifactPayload: "Decision: use Postgres for durable memory",
      normalizedText: "Decision: use Postgres for durable memory"
    });

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("decision");
    expect(candidates[0]?.attributes.evidence).toMatchObject({
      explicitSignals: ["decision_prefix"],
      quality: "high"
    });
  });

  it("extracts mixed-artifact prompt responses into deterministic explicit candidates", () => {
    const event = baseEvent({
      id: "event-2",
      artifactType: "prompt_response",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      artifactPayload: {
        query: "What changed?",
        answer: "Fact: auth middleware is in src/api/server.ts\nDecision: keep workspace scoping"
      },
      normalizedText: JSON.stringify({
        query: "What changed?",
        answer: "Fact: auth middleware is in src/api/server.ts\nDecision: keep workspace scoping"
      })
    });

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.type)).toEqual(["fact", "decision"]);
    expect(candidates[0]?.content).toContain("auth middleware");
    expect(candidates[1]?.content).toContain("keep workspace scoping");
  });

  it("keeps low-signal payloads as low-confidence summaries with low-quality evidence", () => {
    const event = baseEvent({
      id: "event-3",
      artifactType: "documentation",
      artifactPayload: "    ",
      normalizedText: "\n\n"
    });

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("document_summary");
    expect(candidates[0]?.content).toBe("Empty interaction");
    expect(candidates[0]?.attributes.evidence).toMatchObject({
      quality: "low",
      signalCount: 0
    });
  });

  it("resolves conflicting candidate facts deterministically", () => {
    const event = baseEvent({
      id: "event-4",
      artifactType: "conversation",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      normalizedText: "Fact: endpoint uses token auth\nFact: endpoint uses API key auth"
    });

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("fact");
    expect(candidates[0]?.content).toBe("endpoint uses API key auth");
    expect(candidates[0]?.attributes.conflictingContents).toEqual(["endpoint uses token auth"]);
  });

  it("promotes coding intent to a repository-scoped operational note with rich evidence", () => {
    const event = baseEvent({
      id: "event-intent-1",
      artifactType: "coding_intent",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "scripts/demo.py" },
      artifactPayload: {
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement", "omit rationale from code"]
      },
      normalizedText: JSON.stringify({
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement", "omit rationale from code"]
      })
    });

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("operational_note");
    expect(candidates[0]?.scopes).toEqual({
      workspaceId: "w1",
      projectId: "p1",
      repositoryId: "r1"
    });
    expect(candidates[0]?.attributes.originPath).toBe("scripts/demo.py");
    expect(candidates[0]?.attributes.mergeKey).toBe("coding_intent:print_ahhh");
    expect(candidates[0]?.attributes.evidence).toMatchObject({
      extractor: "coding_intent",
      quality: "high"
    });
  });

  it("calibrates confidence by artifact/evidence quality before queueing", async () => {
    const reviewItems: ReviewItem[] = [];
    const savedMemories: MemoryRecord[] = [];

    const memories: MemoryRepository = {
      save: async (memory) => {
        savedMemories.push(memory);
      },
      update: async () => undefined,
      findById: async () => null,
      listByTenant: async () => [],
      findDuplicate: async () => null
    };

    const reviews: ReviewQueueRepository = {
      enqueue: async (item) => {
        reviewItems.push(item);
      },
      listPending: async () => [],
      findById: async () => null,
      update: async () => undefined
    };

    const memoryService = new MemoryService(memories, reviews, new DeterministicEmbeddingProvider(), new ScopeResolver());

    const promptEvent = baseEvent({
      id: "event-5",
      artifactType: "prompt_response",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      artifactPayload: { query: "Where?", answer: "Fact: auth middleware in src/api/server.ts" },
      normalizedText: "unused"
    });

    const docEvent = baseEvent({
      id: "event-6",
      artifactType: "documentation",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "docs/auth.md" },
      artifactPayload: "",
      normalizedText: "\n"
    });

    await memoryService.processCandidates(promptEvent, extraction.extractCandidates(promptEvent));
    await memoryService.processCandidates(docEvent, extraction.extractCandidates(docEvent));

    expect(savedMemories).toHaveLength(1);
    expect(reviewItems).toHaveLength(1);
    expect(savedMemories[0]?.attributes.confidenceCalibration).toMatchObject({
      artifactType: "prompt_response",
      evidenceQuality: "high"
    });
    expect(reviewItems[0]?.candidate.attributes.confidenceCalibration).toMatchObject({
      artifactType: "documentation",
      evidenceQuality: "low"
    });
  });
});
