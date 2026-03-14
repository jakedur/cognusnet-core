export interface CoreManifest {
  repoRole: "core";
  packageName: "cognusnet-core";
  sdkLanguage: "typescript";
  endpoints: string[];
  capabilities: string[];
}

export const coreManifest: CoreManifest = {
  repoRole: "core",
  packageName: "cognusnet-core",
  sdkLanguage: "typescript",
  endpoints: ["/health", "/v1/memory/retrieve", "/v1/memory/write", "/v1/memory/feedback"],
  capabilities: ["reference_server", "typescript_sdk", "postgres_schema", "seed_script", "live_client"]
};
