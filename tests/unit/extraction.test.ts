import { describe, expect, it } from "vitest";

import type { RawEvent } from "../../src/domain/types";
import { ExtractionService } from "../../src/modules/extraction/service";

describe("ExtractionService", () => {
  const extraction = new ExtractionService();

  it("promotes explicit decisions at high confidence", () => {
    const event: RawEvent = {
      id: "event-1",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      actorId: "actor-1",
      artifactType: "conversation",
      artifactPayload: "Decision: use Postgres for durable memory",
      normalizedText: "Decision: use Postgres for durable memory",
      provenance: {
        sourceKind: "conversation",
        sourceLabel: "Team sync",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };

    const candidates = extraction.extractCandidates(event);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("decision");
    expect(candidates[0]?.confidence).toBeGreaterThan(0.9);
  });

  it("keeps generic summaries lower confidence for review", () => {
    const event: RawEvent = {
      id: "event-2",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      actorId: "actor-1",
      artifactType: "conversation",
      artifactPayload: "We discussed cleanup tasks for the memory layer.",
      normalizedText: "We discussed cleanup tasks for the memory layer.",
      provenance: {
        sourceKind: "conversation",
        sourceLabel: "Standup",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };

    const candidates = extraction.extractCandidates(event);
    expect(candidates[0]?.type).toBe("conversation_summary");
    expect(candidates[0]?.confidence).toBeLessThan(0.8);
  });
});
