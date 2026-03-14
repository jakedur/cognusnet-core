import type { Scope } from "../../domain/types";

const scopeLevels = [
  "workspaceId",
  "projectId",
  "repositoryId",
  "userPrivateId"
] as const;

export class ScopeResolver {
  ensureScoped(scope: Scope): void {
    if (!scopeLevels.some((level) => Boolean(scope[level]))) {
      throw new Error("At least one scope level is required");
    }
  }

  isAccessible(requestScope: Scope, candidateScope: Scope): boolean {
    for (const level of scopeLevels) {
      const requestValue = requestScope[level];
      const candidateValue = candidateScope[level];
      if (candidateValue && requestValue !== candidateValue) {
        return false;
      }
    }
    return true;
  }

  scopeDistance(requestScope: Scope, candidateScope: Scope): number {
    if (!this.isAccessible(requestScope, candidateScope)) {
      return Number.POSITIVE_INFINITY;
    }

    let distance = 0;
    for (const level of scopeLevels) {
      if (requestScope[level] && !candidateScope[level]) {
        distance += 1;
      }
    }
    return distance;
  }

  scopeKey(scope: Scope): string {
    return scopeLevels.map((level) => `${level}:${scope[level] ?? "*"}`).join("|");
  }
}
