import type {
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  ReviewItem,
  ReviewListRequest,
  ReviewListResponse
} from "../../domain/types";
import type { RawEventRepository, ReviewQueueRepository } from "../../ports/repositories";
import { AuditService } from "../audit/service";
import { MemoryService } from "../memory/service";
import { ScopeResolver } from "../tenancy/scope";

export class ReviewService {
  constructor(
    private readonly reviews: ReviewQueueRepository,
    private readonly rawEvents: RawEventRepository,
    private readonly memories: MemoryService,
    private readonly audits: AuditService,
    private readonly scopeResolver: ScopeResolver
  ) {}

  async list(input: ReviewListRequest): Promise<ReviewListResponse> {
    this.scopeResolver.ensureScoped(input.scopes);
    const reviewItems = await this.reviews.listPending(input.tenantId);

    return {
      reviewItems: reviewItems.filter((item) => this.matchesScope(item, input.scopes))
    };
  }

  async decide(input: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
    this.scopeResolver.ensureScoped(input.scopes);
    const reviewItem = await this.reviews.findById(input.reviewId);
    if (!reviewItem) {
      throw new Error("Review item not found");
    }
    if (reviewItem.tenantId !== input.tenantId) {
      throw new Error("Forbidden: review item is outside the authenticated tenant");
    }
    if (!this.matchesScope(reviewItem, input.scopes)) {
      throw new Error("Forbidden: review item is outside the requested scope");
    }
    if (reviewItem.status !== "pending") {
      throw new Error("Review item is not pending");
    }
    if (input.action === "edit_and_accept" && !input.content) {
      throw new Error("Content is required when action is edit_and_accept");
    }

    let promotedMemoryId: string | undefined;

    if (input.action === "reject") {
      reviewItem.status = "rejected";
    } else {
      const event = await this.rawEvents.findById(reviewItem.eventId);
      if (!event) {
        throw new Error("Review source event not found");
      }

      if (input.action === "edit_and_accept" && input.content) {
        reviewItem.candidate.content = input.content;
        reviewItem.candidate.title = `Edited: ${input.content}`.slice(0, 120);
        reviewItem.candidate.confidence = Math.max(reviewItem.candidate.confidence, 0.82);
      }

      const promoted = await this.memories.promoteCandidate(event, reviewItem.candidate);
      promotedMemoryId = promoted.id;
      reviewItem.status = "accepted";
    }

    reviewItem.updatedAt = new Date().toISOString();
    await this.reviews.update(reviewItem);

    await this.audits.record({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: `review.${input.action}`,
      resourceType: "review_item",
      resourceId: input.reviewId,
      metadata: {
        promotedMemoryId: promotedMemoryId ?? null,
        scopeKey: this.scopeResolver.scopeKey(input.scopes)
      }
    });

    return {
      reviewItem,
      promotedMemoryId
    };
  }

  private matchesScope(item: ReviewItem, requestedScope: ReviewListRequest["scopes"]): boolean {
    const requestedEntries = Object.entries(requestedScope).filter(([, value]) => Boolean(value));
    return requestedEntries.every(([key, value]) => item.scopes[key as keyof typeof item.scopes] === value);
  }
}
