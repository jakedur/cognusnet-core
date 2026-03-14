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
    this.scopeResolver.ensureScoped(request.scopes);
    const queryEmbedding = await this.embeddings.embed(request.query);
    const tenantMemories = await this.memories.listByTenant(request.tenantId);

    const filtered = tenantMemories.filter((memory) => {
      if (request.memoryTypes && !request.memoryTypes.includes(memory.type)) {
        return false;
      }

      if (!this.scopeResolver.isAccessible(request.scopes, memory.scopes)) {
        return false;
      }

      if (request.recencyDays) {
        const ageInDays = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > request.recencyDays) {
          return false;
        }
      }

      return true;
    });

    const ranked = rankMemories({
      request,
      queryEmbedding,
      candidates: filtered,
      scopeResolver: this.scopeResolver
    }).slice(0, 8);

    await this.audits.record({
      tenantId: request.tenantId,
      actorId: request.actorId,
      action: "memory.retrieve",
      resourceType: "memory_query",
      resourceId: request.query,
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
        queryEmbeddingDimensions: queryEmbedding.length
      }
    };
  }
}
