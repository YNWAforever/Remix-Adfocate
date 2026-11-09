import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminAuthError, AdminRequestError } from "@/lib/admin";
import { createMcpServer, deleteMcpServer, fetchMcpAudit, fetchMcpServers, mcpAdminKeys, updateMcpServer, type AdminMcpServer } from "@/lib/admin/mcp";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/skills")({ component: AdminSkillsPage });

const card = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 space-y-2";
const field = "w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm";
const button = "rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold";
const primary = "rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-lime)] px-3 py-1 text-sm font-bold";

function parseTools(value: string): string[] | null {
  const tools = value.split(",").map(tool => tool.trim()).filter(Boolean);
  return tools.length ? tools : null;
}

export function AdminSkillsPage() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tools, setTools] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: mcpAdminKeys.list(workspace),
    queryFn: () => fetchMcpServers(workspace),
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (list.error instanceof AdminAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  const audit = useQuery({
    queryKey: mcpAdminKeys.audit(workspace),
    queryFn: () => fetchMcpAudit(workspace),
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (audit.error instanceof AdminAuthError) reportAuthError(audit.error);
  }, [audit.error, reportAuthError]);

  const refresh = () => client.invalidateQueries({ queryKey: mcpAdminKeys.all });
  const mutation = useMutation({
    mutationFn: async (action: { kind: "create" } | { kind: "toggle"; server: AdminMcpServer } | { kind: "delete"; server: AdminMcpServer } | { kind: "tools"; server: AdminMcpServer; tools: string[] }) => {
      if (action.kind === "create") {
        const parsed = parseTools(tools);
        if (!name.trim() || !url.trim() || !parsed) throw new Error("invalid");
        return createMcpServer(workspace, { name: name.trim(), url: url.trim(), tools: parsed });
      }
      if (action.kind === "toggle") return updateMcpServer(workspace, action.server.id, { enabled: !action.server.enabled });
      if (action.kind === "delete") return deleteMcpServer(workspace, action.server.id);
      return updateMcpServer(workspace, action.server.id, { tools: action.tools });
    },
    onSuccess: (_data, action) => {
      if (action.kind === "create") { setName(""); setUrl(""); setTools(""); }
      setError(null);
      void refresh();
    },
    onError: (cause) => setError(cause instanceof AdminRequestError && cause.code === "mcp_disabled" ? "disabled" : "failed"),
  });

  if (list.error instanceof AdminRequestError && (list.error.code === "mcp_disabled" || list.error.status === 404)) {
    return <div className={card}><p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.skillsDisabled")}</p></div>;
  }
  if (list.isLoading) return <p className="text-sm">{t("common.loading")}</p>;

  const servers = list.data?.servers ?? [];
  return (
    <div className="space-y-3">
      <div className={card}>
        <h2 className="font-heading font-bold">{t("app.admin.skillsCreate")}</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <input aria-label={t("app.admin.skillsName")} className={field} placeholder={t("app.admin.skillsName")} value={name} onChange={event => setName(event.target.value)} />
          <input aria-label={t("app.admin.skillsUrl")} className={field} placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} />
          <input aria-label={t("app.admin.skillsTools")} className={field} placeholder={t("app.admin.skillsTools")} value={tools} onChange={event => setTools(event.target.value)} />
        </div>
        <button type="button" className={primary} disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "create" })}>{t("app.admin.skillsCreate")}</button>
        {error && <p className="text-sm">{t(error === "disabled" ? "app.admin.skillsDisabled" : "app.admin.skillsError")}</p>}
      </div>

      {servers.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.skillsEmpty")}</p>}
      {servers.map(server => (
        <div className={card} key={server.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-heading font-bold">{server.name}</span>
            <span className="text-xs text-[var(--color-soft-ink)]">{server.url}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {server.tools.map(tool => <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold" key={tool}>{tool}</span>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "toggle", server })}>
              {t(server.enabled ? "app.admin.skillsDisable" : "app.admin.skillsEnable")}
            </button>
            <button type="button" className={button} disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "delete", server })}>
              {t("app.admin.skillsDelete")}
            </button>
            <ToolsEditor server={server} key={server.id + server.tools.join(",")} onSave={next => mutation.mutate({ kind: "tools", server, tools: next })} label={t("app.admin.skillsUpdateTools")} />
          </div>
        </div>
      ))}

      <div className={card}>
        <h2 className="font-heading font-bold">{t("app.admin.skillsAudit")}</h2>
        {audit.data?.summary && audit.data.summary.total > 0 ? (
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.skillsAuditSummary", { n: audit.data.summary.total, ok: audit.data.summary.ok, errors: audit.data.summary.errors, avg: audit.data.summary.avg_duration_ms ?? "-" })}</p>
        ) : null}
        {!audit.data?.calls.length ? <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.skillsAuditEmpty")}</p> : (
          <ul className="space-y-1 text-sm">
            {audit.data.calls.map(call => (
              <li key={`${call.created_at}-${call.server_name}-${call.tool_name}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{new Date(call.created_at).toLocaleString()}</span>
                <span className="font-semibold">{call.server_name} · {call.tool_name}</span>
                <span className={call.outcome === "ok" ? "rounded-full bg-[#e2f4e6] px-2 py-0.5 text-xs font-bold text-[#316444]" : "rounded-full bg-[#fff0ed] px-2 py-0.5 text-xs font-bold text-[#89382f]"}>{call.outcome}</span>
                <span className="text-xs text-[var(--color-soft-ink)]">{call.duration_ms ?? "-"} ms</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ToolsEditor({ server, onSave, label }: { server: AdminMcpServer; onSave: (tools: string[]) => void; label: string }) {
  const [value, setValue] = useState(server.tools.join(", "));
  return (
    <span className="flex flex-1 items-center gap-1">
      <input aria-label={label} className={field + " py-1"} value={value} onChange={event => setValue(event.target.value)} />
      <button type="button" className={button} onClick={() => { const parsed = parseTools(value); if (parsed) onSave(parsed); }}>{label}</button>
    </span>
  );
}
