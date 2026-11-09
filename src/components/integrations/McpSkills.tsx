import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useStudioText } from "@/components/studio/StudioPrimitives";

type McpSkill = { id: string; name: string; tools: string[]; consented: boolean; auth_mode?: string; connected?: boolean; expired?: boolean };
type McpSkillList = { available: boolean; skills: McpSkill[] };

function errorText(error: unknown, tx: (zh: string, en: string) => string): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 401) return tx("登入狀態已過期，請重新登入後再試。", "Your session expired. Sign in again.");
    if (error.status === 403) return tx("只允許同站操作，請重新整理再試。", "Blocked for safety. Reload and try again.");
    if (error.status === 503) {
      return error.code === "MCP_OAUTH_PROVIDER_UNAVAILABLE"
        ? tx("此技能的登入未配置，請聯絡工作區管理員。", "This skill's sign-in is not configured. Contact the workspace owner.")
        : tx("暫時未能連接技能，請稍後再試。", "Could not reach the provider. Try again later.");
    }
    if (error.code === "mcp_disabled") return tx("資料技能暫時停用。", "Data skills are disabled.");
  }
  return tx("未能更新技能狀態，請再試一次。", "Could not update the skill. Try again.");
}

/** Optional "data skills" section for /connections. Renders nothing unless MCP is configured for this workspace. */
export function McpSkills() {
  const tx = useStudioText();
  const client = useQueryClient();
  const [notice, setNotice] = useState<"connected" | "error" | null>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("mcp");
    return value === "connected" || value === "error" ? value : null;
  });
  useEffect(() => {
    if (!notice || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("mcp");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [notice]);

  const list = useQuery({
    queryKey: ["mcp", "skills"],
    queryFn: () => apiFetch<McpSkillList>("/mcp/skills"),
    retry: false,
    staleTime: 30_000,
  });
  const consent = useMutation({
    mutationFn: (input: { id: string; grant: boolean }) =>
      apiFetch(`/mcp/skills/${input.id}/consent`, { method: input.grant ? "POST" : "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mcp", "skills"] }),
  });
  const connect = useMutation({
    mutationFn: async (id: string) => {
      const result = await apiFetch<{ authorizationUrl: string }>(`/mcp/oauth/${id}/start`);
      if (typeof window !== "undefined") window.location.assign(result.authorizationUrl);
      return result;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["mcp", "skills"] }),
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => apiFetch(`/mcp/oauth/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mcp", "skills"] }),
  });

  const hiddenError = list.error instanceof ApiError ? [401, 403, 404, 503].includes(list.error.status) : Boolean(list.error);
  if (hiddenError || !list.data?.available || !list.data.skills.length) return null;
  const failure = errorText(consent.error ?? connect.error ?? disconnect.error, tx);

  return (
    <section id="data-skills" className="s-card s-stack" aria-label={tx("資料技能", "Data skills")} style={{ scrollMarginTop: 24 }}>
      <div className="s-between">
        <div>
          <span className="s-eyebrow">MCP SKILLS</span>
          <h2>{tx("資料技能", "Data skills")}</h2>
        </div>
        <span className="s-tag ghost">{tx("唯讀", "Read only")}</span>
      </div>
      <p className="s-muted">
        {tx("由工作區加入的唯讀技能。討論只會在你允許並連接後讀取。", "Read-only skills added by the workspace owner. Chat only reads a server after you allow and connect it.")}
      </p>
      {notice && (
        <p role="status" className={notice === "error" ? "s-error" : "s-tag mint"}>
          {notice === "connected"
            ? tx("技能已連接，可以在討論中使用了。", "Skill connected. It is ready in chat.")
            : tx("連接未完成，請再試一次；如果問題持續，請聯絡工作區管理員。", "Connection did not complete. Try again; if it keeps failing, contact the workspace owner.")}
          <button type="button" className="s-btn" onClick={() => setNotice(null)}>{tx("知道了", "Dismiss")}</button>
        </p>
      )}
      <div className="s-stack">
        {list.data.skills.map(skill => {
          const oauth = skill.auth_mode === "oauth";
          const needsReconnect = Boolean(skill.expired);
          const state = needsReconnect ? tx("需要重新連接", "Reconnect needed") : skill.connected ? tx("已連接", "Connected") : oauth ? tx("未連接", "Not connected") : tx("未允許", "Not allowed");
          return (
            <article className="s-card s-stack" key={skill.id} aria-label={skill.name}>
              <div className="s-between">
                <h3>{skill.name}</h3>
                <span className="s-row">
                  <span className={`s-tag ${skill.consented ? "mint" : "ghost"}`}>{skill.consented ? tx("已允許", "Allowed") : tx("未允許", "Not allowed")}</span>
                  {oauth && <span className={`s-tag ${skill.connected ? "mint" : "ghost"}`}>{state}</span>}
                </span>
              </div>
              <div className="s-row">{skill.tools.map(tool => <span className="s-tag ghost" key={tool}>{tool}</span>)}</div>
              <div className="s-row">
                {skill.consented
                  ? <button type="button" className="s-btn" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: false })}>{tx("撤回", "Revoke")}</button>
                  : <button type="button" className="s-btn s-primary" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: true })}>{tx("允許唯讀使用", "Allow read-only")}</button>}
                {oauth && skill.consented && !skill.connected && (
                  <button type="button" className="s-btn s-primary" disabled={connect.isPending} onClick={() => connect.mutate(skill.id)}>
                    {connect.isPending ? tx("連接中…", "Connecting…") : needsReconnect ? tx("重新連接", "Reconnect") : tx("連接帳戶", "Connect account")}
                  </button>
                )}
                {oauth && skill.connected && (
                  <button type="button" className="s-btn" disabled={disconnect.isPending} onClick={() => disconnect.mutate(skill.id)}>{tx("中斷連接", "Disconnect")}</button>
                )}
              </div>
              {failure && <small role="alert">{failure}</small>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
