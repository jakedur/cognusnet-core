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

  it("promotes prompt responses to durable coding facts when query and answer are structured", () => {
    const event: RawEvent = {
      id: "event-3",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      actorId: "actor-1",
      artifactType: "prompt_response",
      artifactPayload: {
        query: "Where is the auth middleware?",
        answer: "It lives in api/server.ts."
      },
      normalizedText: JSON.stringify({
        query: "Where is the auth middleware?",
        answer: "It lives in api/server.ts."
      }),
      provenance: {
        sourceKind: "prompt_response",
        sourceLabel: "Control plane",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };

    const candidates = extraction.extractCandidates(event);
    expect(candidates[0]?.type).toBe("fact");
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(candidates[0]?.attributes.mergeKey).toBe("coding_answer:where_is_the_auth_middleware");
  });

  it("promotes coding intent to a repository-scoped operational note", () => {
    const event: RawEvent = {
      id: "event-intent-1",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "scripts/demo.py" },
      actorId: "actor-1",
      artifactType: "coding_intent",
      artifactPayload: {
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement", "omit rationale from code"]
      },
      normalizedText: JSON.stringify({
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement", "omit rationale from code"]
      }),
      provenance: {
        sourceKind: "coding_intent",
        sourceLabel: "Coding intent",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };

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
    expect(candidates[0]?.content).toContain("because the sky is blue");
    expect(candidates[0]?.content).toContain("single print statement");
    expect(candidates[0]?.confidence).toBeGreaterThan(0.9);
  });

  it("promotes code artifacts and docs at high confidence for the coding beta", () => {
    const codeEvent: RawEvent = {
      id: "event-4",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      actorId: "actor-1",
      artifactType: "code_diff",
      artifactPayload: "diff --git a/src/api/server.ts b/src/api/server.ts\n+ auth middleware checks the workspace key",
      normalizedText: "diff --git a/src/api/server.ts b/src/api/server.ts\n+ auth middleware checks the workspace key",
      provenance: {
        sourceKind: "code_diff",
        sourceLabel: "Commit diff",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };
    const docEvent: RawEvent = {
      id: "event-5",
      tenantId: "tenant-alpha",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "docs/auth.md" },
      actorId: "actor-1",
      artifactType: "documentation",
      artifactPayload: "Authentication uses workspace-scoped API keys.",
      normalizedText: "Authentication uses workspace-scoped API keys.",
      provenance: {
        sourceKind: "documentation",
        sourceLabel: "Auth docs",
        actorId: "actor-1",
        capturedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    };

    const codeCandidates = extraction.extractCandidates(codeEvent);
    const docCandidates = extraction.extractCandidates(docEvent);

    expect(codeCandidates[0]?.type).toBe("code_pattern");
    expect(codeCandidates[0]?.confidence).toBeGreaterThan(0.8);
    expect(docCandidates[0]?.type).toBe("document_summary");
    expect(docCandidates[0]?.confidence).toBeGreaterThan(0.8);
  });
});
