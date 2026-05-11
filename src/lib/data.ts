import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Integration, Kind } from "./types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(join(ROOT, "output", name), "utf8")) as T;

export const mcp: Integration[] = load("mcp.json");
export const openapi: Integration[] = load("openapi.json");
export const graphql: Integration[] = load("graphql.json");

export const all: Integration[] = [...mcp, ...openapi, ...graphql];

export const byKind: Record<Kind, Integration[]> = { mcp, openapi, graphql };

export const kindLabel: Record<Kind, string> = {
  mcp: "MCP server",
  openapi: "OpenAPI",
  graphql: "GraphQL",
};
