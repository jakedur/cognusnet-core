import { randomUUID } from "node:crypto";

import type { ArtifactType, CandidateMemory, MemoryRecord, MemorySource, RawEvent, Scope } from "../../domain/types";
import type { MemoryRepository, ReviewQueueRepository } from "../../ports/repositories";
import type { EmbeddingProvider } from "../embeddings/provider";
import { ScopeResolver } from "../tenancy/scope";

type EvidenceQuality = "high" | "medium" | "low";

export class MemoryService {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly reviews: ReviewQueueRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly scopeResolver: ScopeResolver
  ) {}

  async processCandidates(event: RawEvent, candidates: CandidateMemory[]): Promise<{ acceptedCount: number; queuedCount: number }> {
    let acceptedCount = 0;
    let queuedCount = 0;

    for (const candidate of candidates) {
      const normalizedCandidate: CandidateMemory = {
        ...candidate,
        scopes: this.scopeResolver.normalizeScope(candidate.scopes)
      };
      const calibration = this.calibrateConfidence(normalizedCandidate);
      const candidateWithCalibration: CandidateMemory = {
        ...normalizedCandidate,
        confidence: calibration.calibratedConfidence,
        attributes: {
          ...normalizedCandidate.attributes,
          confidenceCalibration: {
            artifactType: calibration.artifactType,
            evidenceQuality: calibration.evidenceQuality,
            threshold: calibration.threshold,
            baseConfidence: calibration.baseConfidence,
            calibratedConfidence: calibration.calibratedConfidence
          }
        }
      };

      const shouldReview =
        candidateWithCalibration.confidence < calibration.threshold ||
        this.scopeResolver.scopeKey(candidateWithCalibration.scopes) === this.scopeResolver.scopeKey({});
      if (shouldReview) {
        await this.reviews.enqueue({
          id: randomUUID(),
          tenantId: candidateWithCalibration.tenantId,
          scopes: candidateWithCalibration.scopes,
          eventId: event.id,
          candidate: candidateWithCalibration,
          reason: candidateWithCalibration.confidence < calibration.threshold ? "low_confidence" : "broad_scope",
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        queuedCount += 1;
        continue;
      }

      await this.saveCandidate(event, candidateWithCalibration);
      acceptedCount += 1;
    }

    return { acceptedCount, queuedCount };
  }

  async applyFeedback(input: {
    tenantId: string;
    scopes: Scope;
    memoryId: string;
    action: "keep" | "edit" | "forget" | "pin" | "mark_stale";
    content?: string;
  }): Promise<MemoryRecord> {
    const memory = await this.memories.findById(input.memoryId);
    if (!memory) {
      throw new Error("Memory not found");
    }

    if (memory.tenantId !== input.tenantId) {
      throw new Error("Forbidden: feedback target is outside the authenticated tenant");
    }

    const normalizedScope = this.scopeResolver.normalizeScope(input.scopes);
    if (this.scopeResolver.scopeKey(memory.scopes) !== this.scopeResolver.scopeKey(normalizedScope)) {
      throw new Error("Forbidden: feedback target is outside the requested scope");
    }

    if (input.action === "edit" && !input.content) {
      throw new Error("Edit feedback requires content");
    }

    if (input.action === "edit" && input.content) {
      memory.content = input.content;
      memory.title = `Edited: ${memory.title}`.slice(0, 120);
      memory.embedding = await this.embeddings.embed(`${memory.title}\n${memory.content}`);
      memory.confidence = Math.min(1, memory.confidence + 0.05);
    }

    if (input.action === "forget") {
      memory.status = "forgotten";
    }

    if (input.action === "pin") {
      memory.pinned = true;
    }

    if (input.action === "mark_stale") {
      memory.stale = true;
      memory.freshness = Math.max(0.1, memory.freshness - 0.4);
    }

    if (input.action === "keep") {
      memory.confidence = Math.min(1, memory.confidence + 0.02);
    }

    memory.updatedAt = new Date().toISOString();
    await this.memories.update(memory);
    return memory;
  }

  async promoteCandidate(event: RawEvent, candidate: CandidateMemory): Promise<MemoryRecord> {
    return this.saveCandidate(event, candidate);
  }

  private calibrateConfidence(candidate: CandidateMemory): {
    artifactType: ArtifactType | "conversation";
    evidenceQuality: EvidenceQuality;
    threshold: number;
    baseConfidence: number;
    calibratedConfidence: number;
  } {
    const artifactType = this.getArtifactType(candidate);
    const evidenceQuality = this.getEvidenceQuality(candidate);

    const typeThreshold: Record<ArtifactType | "conversation", number> = {
      coding_intent: 0.78,
      prompt_response: 0.82,
      documentation: 0.8,
      code_diff: 0.79,
      code_snippet: 0.79,
      conversation: 0.8,
      tool_output: 0.84,
      user_feedback: 0.84
    };

    const thresholdAdjustment: Record<EvidenceQuality, number> = {
      high: -0.05,
      medium: 0,
      low: 0.06
    };

    const confidenceAdjustment: Record<EvidenceQuality, number> = {
      high: 0.04,
      medium: 0,
      low: -0.08
    };

    const threshold = Math.min(0.95, Math.max(0.6, typeThreshold[artifactType] + thresholdAdjustment[evidenceQuality]));
    const calibratedConfidence = Math.min(1, Math.max(0.1, candidate.confidence + confidenceAdjustment[evidenceQuality]));

    return {
      artifactType,
      evidenceQuality,
      threshold,
      baseConfidence: candidate.confidence,
      calibratedConfidence
    };
  }

  private getArtifactType(candidate: CandidateMemory): ArtifactType | "conversation" {
    const artifactType = candidate.attributes.artifactType;
    if (
      artifactType === "coding_intent" ||
      artifactType === "prompt_response" ||
      artifactType === "documentation" ||
      artifactType === "code_diff" ||
      artifactType === "code_snippet" ||
      artifactType === "tool_output" ||
      artifactType === "user_feedback"
    ) {
      return artifactType;
    }
    return "conversation";
  }

  private getEvidenceQuality(candidate: CandidateMemory): EvidenceQuality {
    const evidence = candidate.attributes.evidence;
    if (typeof evidence === "object" && evidence !== null) {
      const quality = (evidence as { quality?: unknown }).quality;
      if (quality === "high" || quality === "medium" || quality === "low") {
        return quality;
      }
    }
    return "medium";
  }

  private async saveCandidate(event: RawEvent, candidate: CandidateMemory): Promise<MemoryRecord> {
    const mergeKey = typeof candidate.attributes.mergeKey === "string" ? candidate.attributes.mergeKey : undefined;
    const duplicate = await this.memories.findDuplicate({
      tenantId: candidate.tenantId,
      scopes: candidate.scopes,
      type: candidate.type,
      title: candidate.title,
      mergeKey
    });

    const source = this.buildSource(event);
    if (duplicate) {
      duplicate.title = candidate.title;
      duplicate.content = candidate.content;
      duplicate.attributes = { ...duplicate.attributes, ...candidate.attributes };
      duplicate.confidence = Math.max(duplicate.confidence, candidate.confidence);
      duplicate.freshness = 1;
      duplicate.sourceIds = Array.from(new Set([...duplicate.sourceIds, event.id]));
      duplicate.sources = [...duplicate.sources, source];
      duplicate.updatedAt = new Date().toISOString();
      duplicate.embedding = await this.embeddings.embed(`${duplicate.title}\n${duplicate.content}`);
      await this.memories.update(duplicate);
      return duplicate;
    }

    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      tenantId: candidate.tenantId,
      scopes: candidate.scopes,
      actorId: candidate.actorId,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      attributes: candidate.attributes,
      confidence: candidate.confidence,
      freshness: candidate.freshness,
      pinned: false,
      stale: false,
      status: "active",
      sourceIds: [event.id],
      sources: [source],
      embedding: await this.embeddings.embed(`${candidate.title}\n${candidate.content}`),
      createdAt: now,
      updatedAt: now
    };

    await this.memories.save(record);
    return record;
  }

  private buildSource(event: RawEvent): MemorySource {
    return {
      eventId: event.id,
      sourceKind: event.provenance.sourceKind,
      sourceLabel: event.provenance.sourceLabel,
      sourceUri: event.provenance.sourceUri,
      actorId: event.actorId,
      capturedAt: event.provenance.capturedAt
    };
  }
}
