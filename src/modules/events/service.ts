import { randomUUID } from "node:crypto";

import type { AuthenticatedActor, RawEvent, WriteMemoryRequest, WriteMemoryResponse } from "../../domain/types";
import type { RawEventRepository } from "../../ports/repositories";
import { AuditService } from "../audit/service";
import { ExtractionService } from "../extraction/service";
import { MemoryService } from "../memory/service";
import { ScopeResolver } from "../tenancy/scope";

export class EventService {
  constructor(
    private readonly rawEvents: RawEventRepository,
    private readonly extraction: ExtractionService,
    private readonly memories: MemoryService,
    private readonly audits: AuditService,
    private readonly scopeResolver: ScopeResolver
  ) {}

  async ingest(request: WriteMemoryRequest, actor: AuthenticatedActor): Promise<WriteMemoryResponse> {
    const normalizedScopes = this.scopeResolver.normalizeScope(request.scopes);
    this.scopeResolver.ensureScoped(normalizedScopes);

    if (request.idempotencyKey) {
      const existing = await this.rawEvents.findByIdempotencyKey(request.tenantId, request.idempotencyKey);
      if (existing) {
        return {
          eventId: existing.id,
          extractionStatus: "duplicate",
          acceptedCount: 0,
          queuedCount: 0
        };
      }
    }

    const event: RawEvent = {
      id: randomUUID(),
      tenantId: request.tenantId,
      scopes: normalizedScopes,
      actorId: request.actorId,
      artifactType: request.artifactType,
      artifactPayload: request.artifactPayload,
      normalizedText: typeof request.artifactPayload === "string" ? request.artifactPayload : JSON.stringify(request.artifactPayload, null, 2),
      provenance: request.provenance,
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date().toISOString()
    };

    await this.rawEvents.save(event);
    const candidates = this.extraction.extractCandidates(event);
    const counts = await this.memories.processCandidates(event, candidates);

    await this.audits.record({
      tenantId: request.tenantId,
      actorId: request.actorId,
      action: "memory.write",
      resourceType: "raw_event",
      resourceId: event.id,
      metadata: {
        apiKeyId: actor.apiKeyId,
        acceptedCount: counts.acceptedCount,
        queuedCount: counts.queuedCount
      }
    });

    return {
      eventId: event.id,
      extractionStatus: "processed",
      acceptedCount: counts.acceptedCount,
      queuedCount: counts.queuedCount
    };
  }
}
