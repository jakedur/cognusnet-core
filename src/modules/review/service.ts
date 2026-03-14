import type { ReviewItem } from "../../domain/types";
import type { ReviewQueueRepository } from "../../ports/repositories";

export class ReviewService {
  constructor(private readonly reviews: ReviewQueueRepository) {}

  async listPending(tenantId?: string): Promise<ReviewItem[]> {
    return this.reviews.listPending(tenantId);
  }
}
