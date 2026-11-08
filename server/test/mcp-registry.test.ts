// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/mcp/oauthCrypto";
import { hasLiveConsent, loadWorkspaceMcpServers, recordMcpCall, runFencedMcpTool } from "../lib/mcp/registry";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; filters: Row; values?: unknown };

function store(rows: Record<string, Row[]>, options: { fail?: boolean; insertError?: boolean } = {}) {
  const calls: Call[] = [];
  const inserted: Row[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: {} };
    calls.push(call);
    const query: Record<string, unknown> = {
      select(fields: string) { call.op = `select:${fields}`; return query; },
      eq(key: string, value: unknown) { call.filters[key] = value; return query; },
      in(key: string, value: unknown) { call.filters[key] = value; return query; },
      is(key: string, value: unknown) { call.filters[key] = value; return query; },
      order() { return query; },
      limit() { return query; },
      maybeSingle() { call.op = "maybe"; return query; },
      insert(values: unknown) { call.op = "insert"; call.values = values; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (options.fail) return Promise.resolve({ data: null, error: { message: "42P01 relation does not exist" } }).then(resolve);
        if (call.op === "insert") {
          if (table === "mcp_call_audit") {
            if (options.insertError) return Promise.resolve({ data: null, error: { message: "denied" } }).then(resolve);
            inserted.push(call.values as Row);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        const data = (rows[table] ?? []).filter(row => Object.entries(call.filters).every(([key, value]) => {
          if (Array.isArray(value)) return value.includes(row[key]);
          if (value === null) return row[key] === null || row[key] === undefined;
          return row[key] === value;
        }));
        return Promise.resolve({ data: call.op === "maybe" ? (data[0] ?? null) : data, error: null }).then(resolve);
      },
    };
    return query;
  };
  return { client: { from } as unknown as Parameters<typeof loadWorkspaceMcpServers>[0], calls, inserted };
}

const servers = [
  { id: "s1", name: "notes", url: "https://mcp.example.test/rpc", enabled: true, read_only: true, workspace_id: "w" },
  { id: "s2", name: "unconsented", url: "https://mcp.example.test/two", enabled: true, read_only: true, workspace_id: "w" },
  { id: "s3", name: "revoked", url: "http://127.0.0.1:9999/mcp", enabled: true, read_only: true, workspace_id: "w" },
];
const tools = [
  { server_id: "s1", tool_name: "lookup_note", enabled: true },
  { server_id: "s1", tool_name: "get_brief", enabled: true },
  { server_id: "s1", tool_name: "disabled_tool", enabled: false },
  { server_id: "s2", tool_name: "secret", enabled: true },
  { server_id: "s3", tool_name: "local_tool", enabled: true },
];
const consents = [
  { server_id: "s1", creator_id: "c", workspace_id: "w", revoked_at: null },
  { server_id: "s2", creator_id: "other", workspace_id: "w", revoked_at: null },
  { server_id: "s3", creator_id: "c", workspace_id: "w", revoked_at: "2026-11-01T00:00:00Z" },
];

afterEach(() => vi.unstubAllEnvs());

describe("mcp workspace registry", () => {
  it("exposes an OAuth server only with a live encrypted token", async () => {
    vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    const oauthServer = { id: "s4", name: "oauth_notes", url: "https://mcp.example.test/oauth", enabled: true, read_only: true, workspace_id: "w", auth_mode: "oauth" };
    const oauthTool = { server_id: "s4", tool_name: "lookup_note", enabled: true };
    const consent = { server_id: "s4", creator_id: "c", workspace_id: "w", revoked_at: null };
    const connection = (over: Row = {}) => ({
      server_id: "s4", creator_id: "c", workspace_id: "w", revoked_at: null,
      access_token_encrypted: encryptSecret("TOKEN"), expires_at: new Date(Date.now() + 60_000).toISOString(), ...over,
    });
    const base = { mcp_servers: [oauthServer], mcp_server_tools: [oauthTool], mcp_consents: [consent] };
    const live = await loadWorkspaceMcpServers(store({ ...base, mcp_oauth_connections: [connection()] }).client, "w", "c");
    expect(live.servers.map(server => server.name)).toEqual(["oauth_notes"]);
    expect(live.servers[0].headers).toMatchObject({ Authorization: "Bearer TOKEN" });
    const missing = await loadWorkspaceMcpServers(store({ ...base }).client, "w", "c");
    expect(missing.servers).toEqual([]);
    const expired = await loadWorkspaceMcpServers(store({ ...base, mcp_oauth_connections: [connection({ expires_at: new Date(Date.now() - 60_000).toISOString() })] }).client, "w", "c");
    expect(expired.servers).toEqual([]);
    const sealed = connection();
    vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", "");
    const noKey = await loadWorkspaceMcpServers(store({ ...base, mcp_oauth_connections: [sealed] }).client, "w", "c");
    expect(noKey.servers).toEqual([]);
  });

  it("returns only read-only, consented servers with enabled allowlisted tools", async () => {
    const fake = store({ mcp_servers: servers, mcp_server_tools: tools, mcp_consents: consents });
    const registry = await loadWorkspaceMcpServers(fake.client, "w", "c");
    expect(registry.available).toBe(true);
    expect(registry.servers.map(server => server.name)).toEqual(["notes"]);
    expect(registry.servers[0].tools.map(tool => tool.name)).toEqual(["lookup_note", "get_brief"]);
    expect(registry.servers[0].url).toBe("https://mcp.example.test/rpc");
    expect(registry.serverIds.get("notes")).toBe("s1");
    const consentCall = fake.calls.find(call => call.table === "mcp_consents");
    expect(consentCall?.filters).toMatchObject({ creator_id: "c", workspace_id: "w", revoked_at: null });
  });

  it("keeps consent fencing live and fails closed on errors", async () => {
    const fake = store({ mcp_consents: consents });
    expect(await hasLiveConsent(fake.client, "s1", "c", "w")).toBe(true);
    expect(await hasLiveConsent(fake.client, "s3", "c", "w")).toBe(false);
    expect(await hasLiveConsent(fake.client, "s1", "other", "w")).toBe(false);
    expect(await hasLiveConsent(store({}, { fail: true }).client, "s1", "c", "w")).toBe(false);
  });

  it("drops an MCP payload when consent is revoked while it runs", async () => {
    const fake = store({ mcp_consents: consents });
    const live = await runFencedMcpTool(fake.client, { serverId: "s1", creatorId: "c", workspaceId: "w" }, async () => "PAYLOAD");
    expect(live).toEqual({ result: "PAYLOAD", outcome: "ok" });
    const revoked = await runFencedMcpTool(fake.client, { serverId: "s3", creatorId: "c", workspaceId: "w" }, async () => "SECRET");
    expect(revoked).toEqual({ result: "error: consent_revoked", outcome: "consent_revoked" });
    const envMode = await runFencedMcpTool(fake.client, { creatorId: "c", workspaceId: "w" }, async () => "error: mcp_timeout");
    expect(envMode).toEqual({ result: "error: mcp_timeout", outcome: "mcp_timeout" });
  });

  it("reports unavailable when the optional tables are missing", async () => {
    const fake = store({}, { fail: true });
    const registry = await loadWorkspaceMcpServers(fake.client, "w", "c");
    expect(registry.available).toBe(false);
    expect(registry.servers).toEqual([]);
  });

  it("records a bounded audit row and never fails on audit errors", async () => {
    const fake = store({});
    await recordMcpCall(fake.client, {
      requestId: "r1", serverName: "notes", toolName: "lookup_note",
      creatorId: "c", workspaceId: "w", outcome: "ok", durationMs: 12.6,
    });
    expect(fake.inserted).toHaveLength(1);
    expect(fake.inserted[0]).toMatchObject({ request_id: "r1", server_name: "notes", tool_name: "lookup_note", outcome: "ok", duration_ms: 13 });
    const failing = store({}, { insertError: true });
    await expect(recordMcpCall(failing.client, {
      serverName: "notes", toolName: "lookup_note", creatorId: "c", workspaceId: "w", outcome: "error: mcp_timeout", durationMs: 9000,
    })).resolves.toBeUndefined();
  });
});
