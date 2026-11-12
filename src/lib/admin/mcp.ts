import { adminFetch } from "@/lib/admin";

export type AdminMcpServer = { id: string; name: string; url: string; enabled: boolean; tools: string[] };

function qs(workspace: string) {
  return workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
}

export function fetchMcpServers(workspace = "") {
  return adminFetch<{ servers: AdminMcpServer[] }>(`/admin/mcp/registry${qs(workspace)}`);
}

export function createMcpServer(workspace: string, input: { name: string; url: string; tools: string[] }) {
  return adminFetch(`/admin/mcp/registry${qs(workspace)}`, { method: "POST", body: JSON.stringify(input) });
}

export function updateMcpServer(workspace: string, id: string, input: Partial<{ enabled: boolean; url: string; tools: string[] }>) {
  return adminFetch(`/admin/mcp/registry/${id}${qs(workspace)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteMcpServer(workspace: string, id: string) {
  return adminFetch(`/admin/mcp/registry/${id}${qs(workspace)}`, { method: "DELETE" });
}

export type AdminMcpCall = { server_name: string; tool_name: string; outcome: string; duration_ms: number | null; created_at: string };

export type AdminMcpAuditSummary = { total: number; ok: number; errors: number; avg_duration_ms: number | null; outcomes: Record<string, number> };
export type AdminMcpServerHealth = { server_name: string; calls: number; ok: number; errors: number; avg_duration_ms: number | null; p50_ms: number | null; p95_ms: number | null; last_ok_at: string | null; last_error_at: string | null; outcomes: Record<string, number> };
export type AdminMcpUsage = { server_name: string; calls_7d: number; calls_24h: number; tools: Array<{ tool_name: string; count: number }> };

export function fetchMcpAudit(workspace = "") {
  return adminFetch<{ calls: AdminMcpCall[]; summary: AdminMcpAuditSummary; health?: AdminMcpServerHealth[]; usage?: AdminMcpUsage[] }>(`/admin/mcp/audit${qs(workspace)}`);
}

export type AdminAssistantReliability = {
  requests: Record<"24h" | "7d", { total: number; saved: number; unknown: number; failed: number; pending: number }>;
  proposals: Record<"24h" | "7d", { total: number; executed: number; failed: number }>;
  last_unknown_at: string | null;
  recent_unknown: Array<{ request_id: string; created_at: string }>;
};

export function fetchAssistantReliability(workspace = "") {
  return adminFetch<AdminAssistantReliability>("/admin/assistant/reliability" + qs(workspace));
}

export const mcpAdminKeys = {
  all: ["admin", "mcp"] as const,
  list: (workspace: string) => ["admin", "mcp", workspace] as const,
  audit: (workspace: string) => ["admin", "mcp", "audit", workspace] as const,
  reliability: (workspace: string) => ["admin", "assistant", "reliability", workspace] as const,
};
