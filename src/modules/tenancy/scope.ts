import type { Scope } from "../../domain/types";

const scopeLevels = [
  "workspaceId",
  "projectId",
  "repositoryId"
] as const;

export class ScopeResolver {
  normalizeScope(scope: Scope): Scope {
    const normalizedPath = scope.path ? this.normalizePath(scope.path) : undefined;
    return {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      repositoryId: scope.repositoryId,
      path: normalizedPath,
      userPrivateId: scope.userPrivateId
    };
  }

  ensureScoped(scope: Scope): void {
    const normalized = this.normalizeScope(scope);
    if (!scopeLevels.some((level) => Boolean(normalized[level])) && !normalized.userPrivateId) {
      throw new Error("At least one scope level is required");
    }

    if (normalized.path && !normalized.repositoryId) {
      throw new Error("Repository-scoped path requires repositoryId");
    }
  }

  isAccessible(requestScope: Scope, candidateScope: Scope): boolean {
    const normalizedRequest = this.normalizeScope(requestScope);
    const normalizedCandidate = this.normalizeScope(candidateScope);

    for (const level of scopeLevels) {
      const requestValue = normalizedRequest[level];
      const candidateValue = normalizedCandidate[level];
      if (candidateValue && requestValue !== candidateValue) {
        return false;
      }
    }

    if (normalizedCandidate.userPrivateId && normalizedRequest.userPrivateId !== normalizedCandidate.userPrivateId) {
      return false;
    }

    return this.isPathAccessible(normalizedRequest.path, normalizedCandidate.path);
  }

  scopeDistance(requestScope: Scope, candidateScope: Scope): number {
    const normalizedRequest = this.normalizeScope(requestScope);
    const normalizedCandidate = this.normalizeScope(candidateScope);

    if (!this.isAccessible(normalizedRequest, normalizedCandidate)) {
      return Number.POSITIVE_INFINITY;
    }

    let distance = 0;
    for (const level of scopeLevels) {
      if (normalizedRequest[level] && !normalizedCandidate[level]) {
        distance += 1;
      }
    }

    if (normalizedRequest.userPrivateId && !normalizedCandidate.userPrivateId) {
      distance += 1;
    }

    distance += this.pathDistance(normalizedRequest.path, normalizedCandidate.path);
    return distance;
  }

  scopeKey(scope: Scope): string {
    const normalized = this.normalizeScope(scope);
    return [
      ...scopeLevels.map((level) => `${level}:${normalized[level] ?? "*"}`),
      `path:${normalized.path ?? "*"}`,
      `userPrivateId:${normalized.userPrivateId ?? "*"}`
    ].join("|");
  }

  describePathMatch(requestScope: Scope, candidateScope: Scope): "exact" | "ancestor" | "repository" | "broader" | "none" {
    const normalizedRequest = this.normalizeScope(requestScope);
    const normalizedCandidate = this.normalizeScope(candidateScope);
    if (!this.isAccessible(normalizedRequest, normalizedCandidate)) {
      return "none";
    }

    if (normalizedRequest.path && normalizedCandidate.path) {
      return normalizedRequest.path === normalizedCandidate.path ? "exact" : "ancestor";
    }

    if (normalizedRequest.path && !normalizedCandidate.path && normalizedCandidate.repositoryId) {
      return "repository";
    }

    if (!normalizedRequest.path && normalizedCandidate.path) {
      return "broader";
    }

    return "none";
  }

  private normalizePath(path: string): string {
    const normalized = path.replaceAll("\\", "/").trim();
    const withoutPrefix = normalized.startsWith("./") ? normalized.slice(2) : normalized;
    const compact = withoutPrefix.replace(/\/+/g, "/");
    if (!compact || compact.startsWith("/")) {
      throw new Error("Path must be repository-relative");
    }

    const segments = compact.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Path must be repository-relative");
    }

    return segments.join("/");
  }

  private isPathAccessible(requestPath: string | undefined, candidatePath: string | undefined): boolean {
    if (!candidatePath) {
      return true;
    }
    if (!requestPath) {
      return true;
    }
    return requestPath === candidatePath || requestPath.startsWith(`${candidatePath}/`);
  }

  private pathDistance(requestPath: string | undefined, candidatePath: string | undefined): number {
    if (!requestPath) {
      return candidatePath ? 0.25 : 0;
    }
    if (!candidatePath) {
      return requestPath.split("/").length;
    }
    if (requestPath === candidatePath) {
      return 0;
    }

    const requestSegments = requestPath.split("/");
    const candidateSegments = candidatePath.split("/");
    return requestSegments.length - candidateSegments.length;
  }
}
