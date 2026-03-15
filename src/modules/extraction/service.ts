import type { ArtifactType, CandidateMemory, RawEvent, Scope } from "../../domain/types";

type EvidenceQuality = "high" | "medium" | "low";

type ExtractionEvidence = {
  extractor: string;
  artifactType: ArtifactType;
  explicitSignals: string[];
  signalCount: number;
  quality: EvidenceQuality;
  hasStructuredPayload: boolean;
  contentLength: number;
};

type CandidateDraft = {
  type: CandidateMemory["type"];
  label: string;
  content: string;
  confidence: number;
  attributes?: Record<string, unknown>;
  scopesOverride?: Scope;
  evidence: ExtractionEvidence;
};

type ArtifactExtractor = {
  name: string;
  extract: (event: RawEvent) => CandidateDraft[];
};

export class ExtractionService {
  private readonly extractors: Partial<Record<ArtifactType, ArtifactExtractor>>;

  constructor() {
    this.extractors = {
      coding_intent: {
        name: "coding-intent",
        extract: (event) => {
          const candidate = this.extractCodingIntentCandidate(event);
          return candidate ? [candidate] : [];
        }
      },
      prompt_response: {
        name: "prompt-response",
        extract: (event) => this.extractPromptResponseCandidates(event)
      },
      documentation: {
        name: "documentation",
        extract: (event) => this.extractDocumentationCandidates(event)
      },
      code_diff: {
        name: "code-diff",
        extract: (event) => this.extractCodeCandidates(event)
      },
      code_snippet: {
        name: "code-snippet",
        extract: (event) => this.extractCodeCandidates(event)
      },
      conversation: {
        name: "conversation",
        extract: (event) => this.extractConversationCandidates(event)
      },
      tool_output: {
        name: "tool-output",
        extract: (event) => this.extractConversationCandidates(event)
      },
      user_feedback: {
        name: "user-feedback",
        extract: (event) => this.extractConversationCandidates(event)
      }
    };
  }

  extractCandidates(event: RawEvent): CandidateMemory[] {
    const extractor = this.extractors[event.artifactType];
    const drafts = extractor ? extractor.extract(event) : this.extractConversationCandidates(event);

    return this.deduplicateDrafts(drafts).map((draft) =>
      this.buildCandidate(event, draft.type, draft.label, draft.content, draft.confidence, {
        ...draft.attributes,
        evidence: draft.evidence
      }, draft.scopesOverride)
    );
  }

  private extractCodingIntentCandidate(event: RawEvent): CandidateDraft | null {
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

    return {
      type: "operational_note",
      label: "Coding intent",
      content: contentLines.join("\n"),
      confidence: 0.9,
      attributes: {
        task,
        ...(rationale ? { rationale } : {}),
        ...(constraints.length > 0 ? { constraints } : {}),
        ...(event.scopes.path ? { originPath: event.scopes.path } : {}),
        mergeKey: `coding_intent:${this.normalizeKey(task)}`
      },
      scopesOverride: {
        workspaceId: event.scopes.workspaceId,
        projectId: event.scopes.projectId,
        repositoryId: event.scopes.repositoryId,
        userPrivateId: event.scopes.userPrivateId
      },
      evidence: {
        extractor: "coding_intent",
        artifactType: event.artifactType,
        explicitSignals: ["task", ...(rationale ? ["rationale"] : []), ...(constraints.length > 0 ? ["constraints"] : [])],
        signalCount: 1 + (rationale ? 1 : 0) + (constraints.length > 0 ? 1 : 0),
        quality: rationale || constraints.length > 0 ? "high" : "medium",
        hasStructuredPayload: true,
        contentLength: contentLines.join("\n").length
      }
    };
  }

  private extractPromptResponseCandidates(event: RawEvent): CandidateDraft[] {
    const payload = event.artifactPayload as { query?: unknown; answer?: unknown } | string;
    if (typeof payload === "string") {
      return this.extractPromptResponseTextFallback(event);
    }

    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (!query || !answer) {
      return this.extractPromptResponseTextFallback(event);
    }

    const explicit = this.extractExplicitLineDrafts(event, answer, "prompt_response");
    if (explicit.length > 0) {
      return explicit;
    }

    return [
      {
        type: "fact",
        label: `Coding fact (${this.summarizeLabel(query)})`,
        content: answer,
        confidence: 0.84,
        attributes: {
          query,
          mergeKey: `coding_answer:${this.normalizeKey(query)}`
        },
        evidence: {
          extractor: "prompt_response",
          artifactType: event.artifactType,
          explicitSignals: ["query", "answer"],
          signalCount: 2,
          quality: answer.length > 60 ? "high" : "medium",
          hasStructuredPayload: true,
          contentLength: answer.length
        }
      }
    ];
  }

  private extractPromptResponseTextFallback(event: RawEvent): CandidateDraft[] {
    const explicit = this.extractExplicitLineDrafts(event, event.normalizedText, "prompt_response");
    if (explicit.length > 0) {
      return explicit;
    }

    const summary = this.summarize(event.normalizedText);
    return [
      {
        type: "conversation_summary",
        label: "Interaction summary",
        content: summary,
        confidence: 0.58,
        attributes: {
          mergeKey: this.buildScopedMergeKey(event, "conversation_summary")
        },
        evidence: {
          extractor: "prompt_response",
          artifactType: event.artifactType,
          explicitSignals: summary === "Empty interaction" ? [] : ["summary"],
          signalCount: summary === "Empty interaction" ? 0 : 1,
          quality: summary === "Empty interaction" ? "low" : "medium",
          hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
          contentLength: summary.length
        }
      }
    ];
  }

  private extractDocumentationCandidates(event: RawEvent): CandidateDraft[] {
    const explicit = this.extractExplicitLineDrafts(event, event.normalizedText, "documentation");
    if (explicit.length > 0) {
      return explicit;
    }

    const summary = this.summarize(event.normalizedText);
    return [
      {
        type: "document_summary",
        label: this.buildScopedLabel("Documentation summary", event),
        content: summary,
        confidence: 0.8,
        attributes: {
          mergeKey: this.buildScopedMergeKey(event, "document_summary")
        },
        evidence: {
          extractor: "documentation",
          artifactType: event.artifactType,
          explicitSignals: summary === "Empty interaction" ? [] : ["summary"],
          signalCount: summary === "Empty interaction" ? 0 : 1,
          quality: summary === "Empty interaction" ? "low" : "medium",
          hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
          contentLength: summary.length
        }
      }
    ];
  }

  private extractCodeCandidates(event: RawEvent): CandidateDraft[] {
    const explicit = this.extractExplicitLineDrafts(event, event.normalizedText, "code");
    if (explicit.length > 0) {
      return explicit;
    }

    const summary = this.summarize(event.normalizedText);
    return [
      {
        type: "code_pattern",
        label: this.buildScopedLabel("Code pattern", event),
        content: summary,
        confidence: 0.78,
        attributes: {
          mergeKey: this.buildScopedMergeKey(event, "code_pattern")
        },
        evidence: {
          extractor: event.artifactType,
          artifactType: event.artifactType,
          explicitSignals: summary === "Empty interaction" ? [] : ["summary"],
          signalCount: summary === "Empty interaction" ? 0 : 1,
          quality: summary === "Empty interaction" ? "low" : "medium",
          hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
          contentLength: summary.length
        }
      }
    ];
  }

  private extractConversationCandidates(event: RawEvent): CandidateDraft[] {
    const explicit = this.extractExplicitLineDrafts(event, event.normalizedText, "conversation");
    if (explicit.length > 0) {
      return explicit;
    }

    const summary = this.summarize(event.normalizedText);
    return [
      {
        type: "conversation_summary",
        label: "Interaction summary",
        content: summary,
        confidence: 0.58,
        attributes: {
          mergeKey: this.buildScopedMergeKey(event, "conversation_summary")
        },
        evidence: {
          extractor: event.artifactType,
          artifactType: event.artifactType,
          explicitSignals: summary === "Empty interaction" ? [] : ["summary"],
          signalCount: summary === "Empty interaction" ? 0 : 1,
          quality: summary === "Empty interaction" ? "low" : "medium",
          hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
          contentLength: summary.length
        }
      }
    ];
  }

  private extractExplicitLineDrafts(event: RawEvent, text: string, extractorName: string): CandidateDraft[] {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const drafts: CandidateDraft[] = [];
    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (lowered.startsWith("decision:")) {
        const content = line.slice(9).trim();
        drafts.push({
          type: "decision",
          label: this.buildScopedLabel("Decision", event),
          content,
          confidence: 0.9,
          attributes: {
            mergeKey: this.buildScopedMergeKey(event, "decision")
          },
          evidence: {
            extractor: extractorName,
            artifactType: event.artifactType,
            explicitSignals: ["decision_prefix"],
            signalCount: 1,
            quality: content.length > 16 ? "high" : "medium",
            hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
            contentLength: content.length
          }
        });
        continue;
      }

      if (lowered.startsWith("pattern:") || lowered.startsWith("convention:")) {
        const content = line.slice(line.indexOf(":") + 1).trim();
        drafts.push({
          type: "code_pattern",
          label: this.buildScopedLabel("Code pattern", event),
          content,
          confidence: 0.85,
          attributes: {
            mergeKey: this.buildScopedMergeKey(event, "code_pattern")
          },
          evidence: {
            extractor: extractorName,
            artifactType: event.artifactType,
            explicitSignals: [lowered.startsWith("pattern:") ? "pattern_prefix" : "convention_prefix"],
            signalCount: 1,
            quality: content.length > 16 ? "high" : "medium",
            hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
            contentLength: content.length
          }
        });
        continue;
      }

      if (lowered.startsWith("fact:")) {
        const content = line.slice(5).trim();
        drafts.push({
          type: "fact",
          label: this.buildScopedLabel("Fact", event),
          content,
          confidence: 0.8,
          attributes: {
            mergeKey: this.buildScopedMergeKey(event, "fact")
          },
          evidence: {
            extractor: extractorName,
            artifactType: event.artifactType,
            explicitSignals: ["fact_prefix"],
            signalCount: 1,
            quality: content.length > 16 ? "high" : extractorName === "prompt_response" ? "medium" : "low",
            hasStructuredPayload: typeof event.artifactPayload === "object" && event.artifactPayload !== null,
            contentLength: content.length
          }
        });
      }
    }

    return drafts;
  }

  private deduplicateDrafts(drafts: CandidateDraft[]): CandidateDraft[] {
    const grouped = new Map<string, CandidateDraft[]>();
    for (const draft of drafts) {
      const mergeKey = typeof draft.attributes?.mergeKey === "string" ? draft.attributes.mergeKey : "";
      const key = `${draft.type}:${mergeKey}`;
      grouped.set(key, [...(grouped.get(key) ?? []), draft]);
    }

    return Array.from(grouped.values()).map((conflicts) => {
      const sorted = [...conflicts].sort((left, right) => {
        if (right.evidence.signalCount !== left.evidence.signalCount) {
          return right.evidence.signalCount - left.evidence.signalCount;
        }
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return left.content.localeCompare(right.content);
      });
      const winner = sorted[0] as CandidateDraft;
      if (sorted.length === 1) {
        return winner;
      }

      return {
        ...winner,
        evidence: {
          ...winner.evidence,
          explicitSignals: [...new Set([...winner.evidence.explicitSignals, "conflicting_candidates"])],
          quality: winner.evidence.quality === "low" ? "low" : "medium"
        },
        attributes: {
          ...winner.attributes,
          conflictingContents: sorted.slice(1).map((draft) => draft.content)
        }
      };
    });
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
