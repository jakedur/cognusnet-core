import { Pool } from "pg";

import { loadConfig } from "../config";

interface SeedConfig {
  tenantId: string;
  tenantName: string;
  actorId: string;
  actorExternalRef: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKey: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
}

function loadSeedConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  return {
    tenantId: env.SEED_TENANT_ID ?? "tenant-alpha",
    tenantName: env.SEED_TENANT_NAME ?? "Tenant Alpha",
    actorId: env.SEED_ACTOR_ID ?? "actor-1",
    actorExternalRef: env.SEED_ACTOR_EXTERNAL_REF ?? "seed-actor",
    apiKeyId: env.SEED_API_KEY_ID ?? "api-key-1",
    apiKeyName: env.SEED_API_KEY_NAME ?? "Local Dev Key",
    apiKey: env.SEED_API_KEY ?? "test-api-key",
    workspaceId: env.SEED_WORKSPACE_ID ?? "workspace-1",
    workspaceName: env.SEED_WORKSPACE_NAME ?? "Workspace One",
    projectId: env.SEED_PROJECT_ID ?? "project-1",
    projectName: env.SEED_PROJECT_NAME ?? "Project One",
    repositoryId: env.SEED_REPOSITORY_ID ?? "repository-1",
    repositoryName: env.SEED_REPOSITORY_NAME ?? "Repository One"
  };
}

export async function seedDatabase(env: NodeJS.ProcessEnv = process.env): Promise<SeedConfig> {
  const appConfig = loadConfig(env);
  const seed = loadSeedConfig(env);
  const pool = new Pool({
    connectionString: appConfig.databaseUrl
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO tenants (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [seed.tenantId, seed.tenantName]
    );

    await client.query(
      `INSERT INTO actors (id, tenant_id, external_ref)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             external_ref = EXCLUDED.external_ref`,
      [seed.actorId, seed.tenantId, seed.actorExternalRef]
    );

    await client.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_hash, role)
       VALUES ($1, $2, $3, $4, 'tenant_admin')
       ON CONFLICT (id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             name = EXCLUDED.name,
             key_hash = EXCLUDED.key_hash,
             role = EXCLUDED.role`,
      [seed.apiKeyId, seed.tenantId, seed.apiKeyName, seed.apiKey]
    );

    await client.query(
      `INSERT INTO workspaces (id, tenant_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             name = EXCLUDED.name`,
      [seed.workspaceId, seed.tenantId, seed.workspaceName]
    );

    await client.query(
      `INSERT INTO projects (id, tenant_id, workspace_id, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             workspace_id = EXCLUDED.workspace_id,
             name = EXCLUDED.name`,
      [seed.projectId, seed.tenantId, seed.workspaceId, seed.projectName]
    );

    await client.query(
      `INSERT INTO repositories (id, tenant_id, project_id, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             project_id = EXCLUDED.project_id,
             name = EXCLUDED.name`,
      [seed.repositoryId, seed.tenantId, seed.projectId, seed.repositoryName]
    );

    await client.query("COMMIT");
    return seed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const seed = await seedDatabase();
  process.stdout.write(
    `${JSON.stringify(
      {
        seeded: true,
        tenantId: seed.tenantId,
        actorId: seed.actorId,
        apiKey: seed.apiKey,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        repositoryId: seed.repositoryId
      },
      null,
      2
    )}\n`
  );
}

if (require.main === module) {
  void main();
}
