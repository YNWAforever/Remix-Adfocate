import { describe, expect, it } from "vitest";
import {
  buildMcpToolDefs,
  findMcpTool,
  loadMcpRegistry,
  mcpToolName,
  parseMcpToolName,
} from "../lib/mcp/policy";

function server(overrides: Record<string, unknown> = {}) {
  return {
    name: "fixture",
    url: "https://mcp.example.test/rpc",
    enabled: true,
    readOnly: true,
    tools: [{ name: "lookup_note", description: "Read one note", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
    ...overrides,
  };
}

describe("mcp registry policy", () => {
  it("stays dark unless explicitly enabled", () => {
    expect(loadMcpRegistry(JSON.stringify([server()]), undefined).servers).toHaveLength(0);
    expect(loadMcpRegistry(JSON.stringify([server()]), "false").servers).toHaveLength(0);
    expect(loadMcpRegistry(undefined, "true").servers).toHaveLength(0);
  });

  it("parses an allowlisted read-only server", () => {
    const registry = loadMcpRegistry(JSON.stringify([server()]), "true");
    expect(registry.errors).toEqual([]);
    expect(registry.servers).toHaveLength(1);
    expect(registry.servers[0]).toMatchObject({ name: "fixture", url: "https://mcp.example.test/rpc", timeoutMs: 8000 });
    expect(registry.servers[0].tools.map(tool => tool.name)).toEqual(["lookup_note"]);
  });

  it("rejects writes, insecure urls, disabled servers and missing tools", () => {
    const raw = JSON.stringify([
      server({ readOnly: false }),
      server({ name: "plain", url: "http://mcp.example.test/rpc" }),
      server({ name: "off", enabled: false }),
      server({ name: "notools", tools: [] }),
    ]);
    const registry = loadMcpRegistry(raw, "true");
    expect(registry.servers).toHaveLength(0);
    expect(registry.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("allows the local fixture over http only", () => {
    const local = loadMcpRegistry(JSON.stringify([server({ url: "http://127.0.0.1:4321/mcp" })]), "true");
    expect(local.servers).toHaveLength(1);
    const remote = loadMcpRegistry(JSON.stringify([server({ url: "http://mcp.example.test/rpc" })]), "true");
    expect(remote.servers).toHaveLength(0);
  });

  it("accepts name-only allowlist entries for discovery", () => {
    const registry = loadMcpRegistry(JSON.stringify([server({ tools: ["lookup_note"] })]), "true");
    expect(registry.servers[0].tools).toEqual([{ name: "lookup_note" }]);
    expect(buildMcpToolDefs(registry.servers)).toEqual([]);
  });

  it("namespaces tools and builds definitions only from the allowlist", () => {
    const registry = loadMcpRegistry(JSON.stringify([server()]), "true");
    const defs = buildMcpToolDefs(registry.servers);
    expect(defs.map(definition => definition.function.name)).toEqual(["mcp__fixture__lookup_note"]);
    expect(mcpToolName("fixture", "lookup_note")).toBe("mcp__fixture__lookup_note");
    expect(parseMcpToolName("mcp__fixture__lookup_note")).toEqual({ server: "fixture", tool: "lookup_note" });
    expect(findMcpTool(registry.servers, "mcp__fixture__lookup_note")?.tool.name).toBe("lookup_note");
    expect(findMcpTool(registry.servers, "mcp__fixture__other")).toBeNull();
    expect(parseMcpToolName("get_my_points")).toBeNull();
    expect(parseMcpToolName("mcp__fixture")).toBeNull();
  });
});
