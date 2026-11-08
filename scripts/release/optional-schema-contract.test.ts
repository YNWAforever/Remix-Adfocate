import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const OPTIONAL_SQL = ["assistant-tool-traces.sql", "mcp-registry.sql", "mcp-oauth.sql"] as const;
const read = (name: string) => readFileSync(`docs/operations/${name}`, "utf8");

describe("optional out-of-band SQL contract", () => {
  it("keeps optional SQL out of the release migration directory", () => {
    const migrations = readdirSync("supabase/migrations");
    for (const name of OPTIONAL_SQL) {
      expect(existsSync(`docs/operations/${name}`), name).toBe(true);
      expect(migrations.some(file => file.endsWith(name)), `${name} must not be a release migration`).toBe(false);
    }
  });

  it("declares the optional MCP and tool-trace schema", () => {
    const registry = read("mcp-registry.sql");
    for (const table of ["mcp_servers", "mcp_server_tools", "mcp_consents", "mcp_call_audit"]) {
      expect(registry, table).toContain(`public.${table}`);
    }
    const oauth = read("mcp-oauth.sql");
    for (const table of ["mcp_oauth_pending", "mcp_oauth_connections"]) {
      expect(oauth, table).toContain(`public.${table}`);
    }
    expect(oauth).toContain("auth_mode");
    expect(read("assistant-tool-traces.sql")).toContain("assistant_tool_traces");
  });

  it("grants optional tables only to service_role", () => {
    for (const name of OPTIONAL_SQL) {
      const sql = read(name);
      expect(sql, name).toMatch(/to\s+service_role/i);
      expect(sql, `${name} must not grant writes to anon/authenticated`).not.toMatch(/grant\s+all\s+on[^;]*\b(anon|authenticated)\b/i);
    }
  });
});
