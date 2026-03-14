import type { AuthenticatedActor, RetrieveMemoryRequest, RetrieveMemoryResponse } from "../../domain/types";
import type { MemoryRepository } from "../../ports/repositories";
import type { EmbeddingProvider } from "../embeddings/provider";
import { AuditService } from "../audit/service";
import { rankMemories } from "./ranker";
import { ScopeResolver } from "../tenancy/scope";

export class RetrievalService {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly audits: AuditService,
    private readonly scopeResolver: ScopeResolver
  ) {}

  async retrieve(request: RetrieveMemoryRequest, actor: AuthenticatedActor): Promise<RetrieveMemoryResponse> {
    const normalizedScopes = this.scopeResolver.normalizeScope(request.scopes);
    this.scopeResolver.ensureScoped(normalizedScopes);
    const normalizedRequest: RetrieveMemoryRequest = {
      ...request,
      scopes: normalizedScopes
    };
    const queryEmbedding = await this.embeddings.embed(normalizedRequest.query);
    const tenantMemories = await this.memories.listByTenant(normalizedRequest.tenantId);

    const filtered = tenantMemories.filter((memory) => {
      if (normalizedRequest.memoryTypes && !normalizedRequest.memoryTypes.includes(memory.type)) {
        return false;
      }

      if (!this.scopeResolver.isAccessible(normalizedRequest.scopes, memory.scopes)) {
        return false;
      }

      if (normalizedRequest.recencyDays) {
        const ageInDays = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > normalizedRequest.recencyDays) {
          return false;
        }
      }

      return true;
    });

    const ranked = rankMemories({
      request: normalizedRequest,
      queryEmbedding,
      candidates: filtered,
      scopeResolver: this.scopeResolver
    }).slice(0, 8);

    await this.audits.record({
      tenantId: normalizedRequest.tenantId,
      actorId: normalizedRequest.actorId,
      action: "memory.retrieve",
      resourceType: "memory_query",
      resourceId: normalizedRequest.query,
      metadata: {
        apiKeyId: actor.apiKeyId,
        candidateCount: filtered.length,
        selectedCount: ranked.length
      }
    });

    return {
      memoryRecords: ranked,
      contextBlock: ranked.length
        ? ranked
            .map((item, index) =>
              [`Memory ${index + 1}: ${item.memory.title}`, `Type: ${item.memory.type}`, `Content: ${item.memory.content}`].join("\n")
            )
            .join("\n\n")
        : "No prior memory found.",
      trace: {
        candidateCount: filtered.length,
        selectedCount: ranked.length,
        queryEmbeddingDimensions: queryEmbedding.length,
        selectedMatches: ranked.map((item) => ({
          memoryId: item.memory.id,
          scopeKey: this.scopeResolver.scopeKey(item.memory.scopes),
          scopeDistance: item.scopeDistance,
          pathMatch: this.scopeResolver.describePathMatch(normalizedRequest.scopes, item.memory.scopes)
        }))
      }
    };
  }
}
