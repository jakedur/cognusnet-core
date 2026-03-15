import type { CandidateMemory, RawEvent, Scope } from "../../domain/types";

export class ExtractionService {
  extractCandidates(event: RawEvent): CandidateMemory[] {
    if (event.artifactType === "coding_intent") {
      const codingIntentCandidate = this.extractCodingIntentCandidate(event);
      if (codingIntentCandidate) {
        return [codingIntentCandidate];
      }
    }

    if (event.artifactType === "prompt_response") {
      const promptResponseCandidate = this.extractPromptResponseCandidate(event);
      if (promptResponseCandidate) {
        return [promptResponseCandidate];
      }
    }

    const lines = event.normalizedText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const candidates: CandidateMemory[] = [];

    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (lowered.startsWith("decision:")) {
        candidates.push(
          this.buildCandidate(event, "decision", this.buildScopedLabel("Decision", event), line.slice(9).trim(), 0.95, {
            mergeKey: this.buildScopedMergeKey(event, "decision")
          })
        );
        continue;
      }

      if (lowered.startsWith("pattern:") || lowered.startsWith("convention:")) {
        const content = line.slice(line.indexOf(":") + 1).trim();
        candidates.push(
          this.buildCandidate(event, "code_pattern", this.buildScopedLabel("Code pattern", event), content, 0.9, {
            mergeKey: this.buildScopedMergeKey(event, "code_pattern")
          })
        );
        continue;
      }

      if (lowered.startsWith("fact:")) {
        candidates.push(
          this.buildCandidate(event, "fact", this.buildScopedLabel("Fact", event), line.slice(5).trim(), 0.88, {
            mergeKey: this.buildScopedMergeKey(event, "fact")
          })
        );
      }
    }

    if (candidates.length > 0) {
      return candidates;
    }

    if (event.artifactType === "code_snippet" || event.artifactType === "code_diff") {
      return [
        this.buildCandidate(
          event,
          "code_pattern",
          this.buildScopedLabel("Code pattern", event),
          this.summarize(event.normalizedText),
          0.86,
          {
            mergeKey: this.buildScopedMergeKey(event, "code_pattern")
          }
        )
      ];
    }

    if (event.artifactType === "documentation") {
      return [
        this.buildCandidate(
          event,
          "document_summary",
          this.buildScopedLabel("Documentation summary", event),
          this.summarize(event.normalizedText),
          0.84,
          {
            mergeKey: this.buildScopedMergeKey(event, "document_summary")
          }
        )
      ];
    }

    return [
      this.buildCandidate(
        event,
        "conversation_summary",
        "Interaction summary",
        this.summarize(event.normalizedText),
        0.58,
        {
          mergeKey: this.buildScopedMergeKey(event, "conversation_summary")
        }
      )
    ];
  }

  private buildCandidate(
    event: RawEvent,
    type: CandidateMemory["type"],
    label: string,
    content: string,
    confidence: number,
    attributes?: Record<string, unknown>,
    scopesOverride?: Scope
  ): CandidateMemory {
    return {
      tenantId: event.tenantId,
      scopes: scopesOverride ?? event.scopes,
      actorId: event.actorId,
      type,
      title: content ? `${label}: ${content.slice(0, 80)}` : label,
      content,
      attributes: {
        artifactType: event.artifactType,
        ...(event.scopes.path ? { path: event.scopes.path } : {}),
        ...attributes
      },
      confidence,
      freshness: 1
    };
  }

  private extractCodingIntentCandidate(event: RawEvent): CandidateMemory | null {
    const payload = event.artifactPayload as
      | {
          task?: unknown;
          rationale?: unknown;
          constraints?: unknown;
        }
      | string;
    if (typeof payload === "string") {
      return null;
    }

    const task = typeof payload.task === "string" ? payload.task.trim() : "";
    const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
    const constraints = Array.isArray(payload.constraints)
      ? payload.constraints.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];

    if (!task) {
      return null;
    }

    const contentLines = [`Task: ${task}`];
    if (rationale) {
      contentLines.push(`Rationale: ${rationale}`);
    }
    if (constraints.length > 0) {
      contentLines.push(`Constraints: ${constraints.join("; ")}`);
    }

    return this.buildCandidate(
      event,
      "operational_note",
      "Coding intent",
      contentLines.join("\n"),
      0.94,
      {
        task,
        ...(rationale ? { rationale } : {}),
        ...(constraints.length > 0 ? { constraints } : {}),
        ...(event.scopes.path ? { originPath: event.scopes.path } : {}),
        mergeKey: `coding_intent:${this.normalizeKey(task)}`
      },
      {
        workspaceId: event.scopes.workspaceId,
        projectId: event.scopes.projectId,
        repositoryId: event.scopes.repositoryId,
        userPrivateId: event.scopes.userPrivateId
      }
    );
  }

  private extractPromptResponseCandidate(event: RawEvent): CandidateMemory | null {
    const payload = event.artifactPayload as { query?: unknown; answer?: unknown } | string;
    if (typeof payload === "string") {
      return null;
    }

    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (!query || !answer) {
      return null;
    }

    const explicit = this.extractExplicitLineCandidate(event, answer);
    if (explicit) {
      return explicit;
    }

    return this.buildCandidate(event, "fact", `Coding fact (${this.summarizeLabel(query)})`, answer, 0.9, {
      query,
      mergeKey: `coding_answer:${this.normalizeKey(query)}`
    });
  }

  private extractExplicitLineCandidate(event: RawEvent, text: string): CandidateMemory | null {
    const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (!line) {
      return null;
    }

    const lowered = line.toLowerCase();
    if (lowered.startsWith("decision:")) {
      return this.buildCandidate(event, "decision", this.buildScopedLabel("Decision", event), line.slice(9).trim(), 0.95, {
        mergeKey: this.buildScopedMergeKey(event, "decision")
      });
    }
    if (lowered.startsWith("pattern:") || lowered.startsWith("convention:")) {
      const content = line.slice(line.indexOf(":") + 1).trim();
      return this.buildCandidate(event, "code_pattern", this.buildScopedLabel("Code pattern", event), content, 0.9, {
        mergeKey: this.buildScopedMergeKey(event, "code_pattern")
      });
    }
    if (lowered.startsWith("fact:")) {
      return this.buildCandidate(event, "fact", this.buildScopedLabel("Fact", event), line.slice(5).trim(), 0.88, {
        mergeKey: this.buildScopedMergeKey(event, "fact")
      });
    }
    return null;
  }

  private buildScopedLabel(baseLabel: string, event: RawEvent): string {
    return event.scopes.path ? `${baseLabel} @ ${event.scopes.path}` : baseLabel;
  }

  private buildScopedMergeKey(event: RawEvent, type: CandidateMemory["type"]): string {
    const pathKey = event.scopes.path ? `path:${event.scopes.path}` : `source:${this.normalizeKey(event.provenance.sourceLabel)}`;
    return `${type}:${pathKey}`;
  }

  private summarizeLabel(text: string): string {
    const compact = this.summarize(text);
    return compact.length <= 48 ? compact : `${compact.slice(0, 45)}...`;
  }

  private normalizeKey(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9/_.-]+/g, "_").replace(/^_+|_+$/g, "");
  }

  private summarize(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) {
      return "Empty interaction";
    }
    return compact.length <= 220 ? compact : `${compact.slice(0, 217)}...`;
  }
}
