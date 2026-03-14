import type { CandidateMemory, RawEvent } from "../../domain/types";

export class ExtractionService {
  extractCandidates(event: RawEvent): CandidateMemory[] {
    const lines = event.normalizedText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const candidates: CandidateMemory[] = [];

    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (lowered.startsWith("decision:")) {
        candidates.push(this.buildCandidate(event, "decision", "Decision", line.slice(9).trim(), 0.95));
        continue;
      }

      if (lowered.startsWith("pattern:") || lowered.startsWith("convention:")) {
        const content = line.slice(line.indexOf(":") + 1).trim();
        candidates.push(this.buildCandidate(event, "code_pattern", "Code pattern", content, 0.9));
        continue;
      }

      if (lowered.startsWith("fact:")) {
        candidates.push(this.buildCandidate(event, "fact", "Fact", line.slice(5).trim(), 0.88));
      }
    }

    if (candidates.length > 0) {
      return candidates;
    }

    if (event.artifactType === "code_snippet" || event.artifactType === "code_diff") {
      return [this.buildCandidate(event, "code_pattern", "Code change summary", this.summarize(event.normalizedText), 0.82)];
    }

    return [
      this.buildCandidate(
        event,
        event.artifactType === "documentation" ? "document_summary" : "conversation_summary",
        "Interaction summary",
        this.summarize(event.normalizedText),
        0.58
      )
    ];
  }

  private buildCandidate(
    event: RawEvent,
    type: CandidateMemory["type"],
    label: string,
    content: string,
    confidence: number
  ): CandidateMemory {
    return {
      tenantId: event.tenantId,
      scopes: event.scopes,
      actorId: event.actorId,
      type,
      title: `${label}: ${content.slice(0, 80)}`,
      content,
      attributes: {
        artifactType: event.artifactType
      },
      confidence,
      freshness: 1
    };
  }

  private summarize(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) {
      return "Empty interaction";
    }
    return compact.length <= 220 ? compact : `${compact.slice(0, 217)}...`;
  }
}
