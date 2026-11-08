import {
  MCP_MAX_RESPONSE_BYTES,
  buildMcpToolDefs,
  findMcpTool,
  type McpServerConfig,
} from "./policy.js";

export type McpFailure = "mcp_unavailable" | "mcp_timeout" | "mcp_invalid_response" | "mcp_tool_error";

export class McpError extends Error {
  constructor(readonly code: McpFailure, message: string) { super(message); }
}

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "kocmax-studio", version: "0.1.0" };
let requestId = 0;

type RpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function parseRpcBody(text: string, contentType: string): RpcMessage {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (contentType.includes("text/event-stream")) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as unknown;
        if (parsed && typeof parsed === "object") return parsed as RpcMessage;
      } catch { /* try the next event */ }
    }
    throw new McpError("mcp_invalid_response", "MCP stream had no JSON-RPC payload");
  }
  try {
    return JSON.parse(trimmed) as RpcMessage;
  } catch {
    throw new McpError("mcp_invalid_response", "MCP response was not JSON");
  }
}

async function post(
  server: McpServerConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<{ response: Response; text: string; sessionId?: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), server.timeoutMs);
  try {
    const response = await fetch(server.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...server.headers,
      },
      body: JSON.stringify(body),
    });
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MCP_MAX_RESPONSE_BYTES) {
      throw new McpError("mcp_invalid_response", "MCP response exceeded the size cap");
    }
    return {
      response,
      text: new TextDecoder().decode(buffer),
      sessionId: response.headers.get("mcp-session-id") ?? sessionId,
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (controller.signal.aborted) throw new McpError("mcp_timeout", "MCP request timed out");
    throw new McpError("mcp_unavailable", error instanceof Error ? error.message.slice(0, 120) : "MCP request failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function rpc(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<{ result: unknown; sessionId?: string }> {
  const id = ++requestId;
  const { response, text, sessionId: nextSession } = await post(server, { jsonrpc: "2.0", id, method, params }, signal, sessionId);
  if (!response.ok) throw new McpError("mcp_unavailable", `MCP HTTP ${response.status}`);
  const message = parseRpcBody(text, response.headers.get("content-type") ?? "");
  if (message.error) {
    throw new McpError("mcp_unavailable", String(message.error.message ?? "MCP error").slice(0, 120));
  }
  return { result: message.result, sessionId: nextSession };
}

async function notify(server: McpServerConfig, method: string, signal?: AbortSignal, sessionId?: string): Promise<void> {
  try {
    const { response } = await post(server, { jsonrpc: "2.0", method }, signal, sessionId);
    if (!response.ok && response.status !== 202 && response.status !== 204) {
      throw new McpError("mcp_unavailable", `MCP HTTP ${response.status}`);
    }
  } catch (error) {
    // Some servers accept the handshake without the initialized notification; only rethrow
    // transport/timeout failures so a real outage still fails the call.
    if (error instanceof McpError && (error.code === "mcp_timeout" || error.code === "mcp_unavailable")) throw error;
  }
}

function formatResult(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result ?? null);
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content.map(part => {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return JSON.stringify(part);
    }).join("\n");
    return (result as { isError?: unknown }).isError === true ? `tool_error: ${text}` : text;
  }
  return JSON.stringify(result);
}

/** Calls one allowlisted MCP tool and returns a bounded string for the model. Never throws. */
export async function callMcpTool(
  server: McpServerConfig,
  tool: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<string> {
  const started = Date.now();
  try {
    const init = await rpc(server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, signal);
    await notify(server, "notifications/initialized", signal, init.sessionId);
    let args: Record<string, unknown> = {};
    try {
      const parsed = argsJson ? JSON.parse(argsJson) : {};
      args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new McpError("mcp_unavailable", "Invalid tool arguments");
    }
    const call = await rpc(server, "tools/call", { name: tool, arguments: args }, signal, init.sessionId);
    const text = formatResult(call.result).slice(0, 6000);
    console.info(`[mcp] ${server.name}.${tool} ok ${Date.now() - started}ms`);
    return text;
  } catch (error) {
    const known = error instanceof McpError ? error : new McpError("mcp_unavailable", "MCP call failed");
    console.info(`[mcp] ${server.name}.${tool} ${known.code} ${Date.now() - started}ms`);
    return `error: ${known.code}`;
  }
}

/** Builds the tool definitions and the dispatcher for the studio loop. */
export function createMcpRuntime(servers: readonly McpServerConfig[]) {
  return {
    defs: buildMcpToolDefs(servers),
    async run(name: string, args: string, signal?: AbortSignal): Promise<string> {
      const found = findMcpTool(servers, name);
      if (!found) return "error: tool_not_allowed";
      return callMcpTool(found.server, found.tool.name, args, signal);
    },
  };
}
