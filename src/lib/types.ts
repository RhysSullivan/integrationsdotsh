export type Kind = "mcp" | "openapi" | "graphql";

export type Feed = "claude" | "openai" | "apis-guru" | "graphql-apis" | "override";

export interface Integration {
  id: string;
  kind: Kind;
  slug: string;
  name: string;
  description: string;
  url?: string;
  icon?: string;
  categories: string[];
  feeds: Feed[];
  popularity?: number;
  mcp?: {
    remoteUrl?: string;
    transport?: string;
    isAuthless?: boolean;
    toolNames?: string[];
    authTypes?: string[];
    worksWith?: string[];
  };
  openapi?: {
    provider: string;
    service?: string;
    version: string;
    swaggerUrl?: string;
    swaggerYamlUrl?: string;
    openapiVer: string;
    updated?: string;
    added?: string;
  };
  graphql?: {
    endpoint: string;
    hasSecurity: boolean;
    docs: { description?: string; url: string }[];
  };
  raw: Partial<Record<Feed, unknown>>;
  tools?: ExtractedTool[];
  toolsStatus?: "ok" | "error" | "skipped";
  toolsReason?: string;
}

export interface ExtractedTool {
  id: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}
