import { randomUUID } from "node:crypto";

import type { CandidateMemory, MemoryRecord, MemorySource, RawEvent, Scope } from "../../domain/types";
import type { MemoryRepository, ReviewQueueRepository } from "../../ports/repositories";
import type { EmbeddingProvider } from "../embeddings/provider";
import { ScopeResolver } from "../tenancy/scope";

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
      const shouldReview = candidate.confidence < 0.8 || this.scopeResolver.scopeKey(candidate.scopes) === this.scopeResolver.scopeKey({});
      if (shouldReview) {
        await this.reviews.enqueue({
          id: randomUUID(),
          tenantId: candidate.tenantId,
          scopes: candidate.scopes,
          eventId: event.id,
          candidate,
          reason: candidate.confidence < 0.8 ? "low_confidence" : "broad_scope",
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        queuedCount += 1;
        continue;
      }

      await this.saveCandidate(event, candidate);
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

    if (this.scopeResolver.scopeKey(memory.scopes) !== this.scopeResolver.scopeKey(input.scopes)) {
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

  private async saveCandidate(event: RawEvent, candidate: CandidateMemory): Promise<void> {
    const duplicate = await this.memories.findDuplicate({
      tenantId: candidate.tenantId,
      scopes: candidate.scopes,
      type: candidate.type,
      title: candidate.title
    });

    const source = this.buildSource(event);
    if (duplicate) {
      duplicate.content = candidate.content;
      duplicate.attributes = { ...duplicate.attributes, ...candidate.attributes };
      duplicate.confidence = Math.max(duplicate.confidence, candidate.confidence);
      duplicate.freshness = 1;
      duplicate.sourceIds = Array.from(new Set([...duplicate.sourceIds, event.id]));
      duplicate.sources = [...duplicate.sources, source];
      duplicate.updatedAt = new Date().toISOString();
      duplicate.embedding = await this.embeddings.embed(`${duplicate.title}\n${duplicate.content}`);
      await this.memories.update(duplicate);
      return;
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
