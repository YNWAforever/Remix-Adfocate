import type { ToolDef } from "../llm.js";

export const MCP_TOOL_PREFIX = "mcp__";
export const MCP_MAX_SERVERS = 5;
export const MCP_MAX_TOOLS_PER_SERVER = 10;
export const MCP_MAX_TIMEOUT_MS = 15000;
export const MCP_DEFAULT_TIMEOUT_MS = 8000;
export const MCP_MAX_RESPONSE_BYTES = 524288;

const SERVER_NAME = /^[a-z0-9_]{1,32}$/;
const TOOL_NAME = /^[a-z0-9_]{1,64}$/;

export type McpRemoteTool = Readonly<{
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}>;

/** A tool with metadata may be exposed without calling tools/list first. */
export type CompleteMcpTool = McpRemoteTool & { description: string; inputSchema: Record<string, unknown> };

export function isCompleteTool(tool: McpRemoteTool): tool is CompleteMcpTool {
  return typeof tool.description === "string" && tool.description.length > 0 && Boolean(tool.inputSchema) && typeof tool.inputSchema === "object";
}

export type McpServerConfig = Readonly<{
  name: string;
  url: string;
  timeoutMs: number;
  headers: Readonly<Record<string, string>>;
  tools: readonly McpRemoteTool[];
}>;

export type McpRegistry = Readonly<{ servers: readonly McpServerConfig[]; errors: readonly string[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLocalFixture(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
}

function parseTool(raw: unknown, index: number, errors: string[], serverName: string): McpRemoteTool | null {
  if (typeof raw === "string") {
    if (!TOOL_NAME.test(raw)) { errors.push(`mcp:${serverName}: tool ${index} has an invalid name`); return null; }
    return { name: raw };
  }
  if (!isRecord(raw)) { errors.push(`mcp:${serverName}: tool ${index} is not a string or object`); return null; }
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!TOOL_NAME.test(name)) { errors.push(`mcp:${serverName}: tool ${index} has an invalid name`); return null; }
  const description = typeof raw.description === "string" ? raw.description.slice(0, 300) : undefined;
  const schema = raw.inputSchema ?? raw.input_schema;
  const inputSchema = isRecord(schema) ? schema : undefined;
  if (inputSchema && inputSchema.type !== "object") {
    errors.push(`mcp:${serverName}:${name}: inputSchema must be an object schema`);
    return null;
  }
  return { name, ...(description ? { description } : {}), ...(inputSchema ? { inputSchema } : {}) };
}

/** Parses the static, env-driven registry. Never trusts a remote tool list to widen the allowlist. */
export function loadMcpRegistry(
  raw = process.env.STUDIO_MCP_SERVERS,
  enabled = process.env.STUDIO_MCP_ENABLED,
): McpRegistry {
  const errors: string[] = [];
  if (enabled !== "true") return { servers: [], errors };
  if (!raw?.trim()) return { servers: [], errors };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { servers: [], errors: ["mcp: config is not valid JSON"] }; }
  const list: unknown[] = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.servers) ? parsed.servers : [];
  if (!Array.isArray(parsed) && list.length === 0) errors.push("mcp: config must be an array or { servers: [] }");
  if (list.length > MCP_MAX_SERVERS) { errors.push(`mcp: at most ${MCP_MAX_SERVERS} servers`); return { servers: [], errors }; }
  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const [index, value] of list.entries()) {
    if (!isRecord(value)) { errors.push(`mcp: server ${index} is not an object`); continue; }
    const name = typeof value.name === "string" ? value.name : "";
    if (!SERVER_NAME.test(name) || seen.has(name)) { errors.push(`mcp: server ${index} has an invalid or duplicate name`); continue; }
    if (value.enabled !== true) { errors.push(`mcp:${name}: disabled`); continue; }
    if (value.readOnly !== true) { errors.push(`mcp:${name}: readOnly must be true`); continue; }
    let url: URL;
    try { url = new URL(String(value.url)); } catch { errors.push(`mcp:${name}: invalid url`); continue; }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalFixture(url))) {
      errors.push(`mcp:${name}: url must be https (localhost http allowed for the local fixture)`);
      continue;
    }
    const timeoutMs = Math.min(MCP_MAX_TIMEOUT_MS, Math.max(1000, Number(value.timeoutMs) || MCP_DEFAULT_TIMEOUT_MS));
    const headers: Record<string, string> = {};
    if (isRecord(value.headers)) {
      let count = 0;
      for (const [key, header] of Object.entries(value.headers)) {
        if (count++ >= 8) break;
        if (typeof header === "string" && /^[A-Za-z0-9-]{1,64}$/.test(key)) headers[key] = header;
      }
    }
    if (!Array.isArray(value.tools) || value.tools.length === 0) { errors.push(`mcp:${name}: no tools allowlisted`); continue; }
    if (value.tools.length > MCP_MAX_TOOLS_PER_SERVER) { errors.push(`mcp:${name}: at most ${MCP_MAX_TOOLS_PER_SERVER} tools`); continue; }
    const tools: McpRemoteTool[] = [];
    for (const [toolIndex, tool] of value.tools.entries()) {
      const parsedTool = parseTool(tool, toolIndex, errors, name);
      if (parsedTool && !tools.some(existing => existing.name === parsedTool.name)) tools.push(parsedTool);
    }
    if (!tools.length) continue;
    seen.add(name);
    servers.push({ name, url: url.toString(), timeoutMs, headers, tools });
  }
  return { servers, errors };
}

export function mcpToolName(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}__${tool}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const split = rest.indexOf("__");
  if (split <= 0 || split >= rest.length - 2) return null;
  const server = rest.slice(0, split), tool = rest.slice(split + 2);
  if (!SERVER_NAME.test(server) || !TOOL_NAME.test(tool)) return null;
  return { server, tool };
}

/** Tool definitions for the studio loop, built only from the allowlisted config (complete rows). */
export function buildMcpToolDefs(servers: readonly McpServerConfig[]): ToolDef[] {
  return servers.flatMap(server => server.tools.filter(isCompleteTool).map(tool => ({
    type: "function" as const,
    function: {
      name: mcpToolName(server.name, tool.name),
      description: `[MCP:${server.name}] ${tool.description}`.slice(0, 300),
      parameters: tool.inputSchema,
    },
  })));
}

export function findMcpTool(servers: readonly McpServerConfig[], fullName: string): { server: McpServerConfig; tool: McpRemoteTool } | null {
  const parsed = parseMcpToolName(fullName);
  if (!parsed) return null;
  const server = servers.find(candidate => candidate.name === parsed.server);
  const tool = server?.tools.find(candidate => candidate.name === parsed.tool);
  return server && tool ? { server, tool } : null;
}
