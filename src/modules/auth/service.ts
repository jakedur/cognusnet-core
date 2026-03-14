import type { AuthenticatedActor } from "../../domain/types";
import type { ApiKeyRepository } from "../../ports/repositories";

export class AuthService {
  constructor(private readonly apiKeys: ApiKeyRepository) {}

  async authenticate(apiKey: string | undefined, requestedTenantId: string): Promise<AuthenticatedActor> {
    if (!apiKey) {
      throw new Error("Missing API key");
    }

    const keyRecord = await this.apiKeys.findByKey(apiKey);
    if (!keyRecord) {
      throw new Error("Invalid API key");
    }

    if (keyRecord.tenantId !== requestedTenantId) {
      throw new Error("Tenant mismatch");
    }

    return {
      apiKeyId: keyRecord.id,
      tenantId: keyRecord.tenantId,
      role: keyRecord.role
    };
  }
}
