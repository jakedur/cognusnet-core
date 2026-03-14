import type { MemoryRecord, RetrievedMemory, RetrieveMemoryRequest } from "../../domain/types";
import { cosineSimilarity } from "../embeddings/provider";
import { ScopeResolver } from "../tenancy/scope";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];
}

export function lexicalScore(query: string, candidate: string): number {
  const queryTokens = new Set(tokenize(query));
  const candidateTokens = tokenize(candidate);

  if (queryTokens.size === 0 || candidateTokens.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.size;
}

export function rankMemories(input: {
  request: RetrieveMemoryRequest;
  queryEmbedding: number[];
  candidates: MemoryRecord[];
  scopeResolver: ScopeResolver;
}): RetrievedMemory[] {
  const { request, queryEmbedding, candidates, scopeResolver } = input;

  return candidates
    .map((memory) => {
      const scopeDistance = scopeResolver.scopeDistance(request.scopes, memory.scopes);
      if (!Number.isFinite(scopeDistance) || memory.status !== "active" || memory.stale) {
        return null;
      }

      const lexical = lexicalScore(request.query, `${memory.scopes.path ?? ""}\n${memory.title}\n${memory.content}`);
      const semantic = cosineSimilarity(queryEmbedding, memory.embedding);
      const scopeWeight = Math.max(0, 1 - scopeDistance * 0.18);
      const score =
        lexical * 0.5 +
        semantic * 0.2 +
        Math.max(memory.confidence, 0.1) * 0.15 +
        Math.max(memory.freshness, 0.1) * 0.1 +
        scopeWeight * 0.05 +
        (memory.pinned ? 0.15 : 0);

      return {
        memory,
        score: Number(score.toFixed(6)),
        lexicalScore: Number(lexical.toFixed(6)),
        semanticScore: Number(semantic.toFixed(6)),
        scopeDistance
      };
    })
    .filter((item): item is RetrievedMemory => item !== null)
    .sort((left, right) => right.score - left.score);
}
