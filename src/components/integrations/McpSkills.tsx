import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useStudioText } from "@/components/studio/StudioPrimitives";

type McpSkill = { id: string; name: string; tools: string[]; consented: boolean; auth_mode?: string; connected?: boolean };
type McpSkillList = { available: boolean; skills: McpSkill[] };

/**
 * Optional "data skills" section for /connections. Renders nothing unless the server has the MCP
 * registry enabled and at least one server is configured for this workspace.
 */
export function McpSkills() {
  const tx = useStudioText();
  const client = useQueryClient();
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
  const failure = consent.error ?? connect.error ?? disconnect.error;

  return (
    <section className="s-card s-stack" aria-label={tx("資料技能", "Data skills")}>
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
      <div className="s-stack">
        {list.data.skills.map(skill => {
          const oauth = skill.auth_mode === "oauth";
          return (
            <article className="s-card s-stack" key={skill.id} aria-label={skill.name}>
              <div className="s-between">
                <h3>{skill.name}</h3>
                <span className="s-row">
                  <span className={`s-tag ${skill.consented ? "mint" : "ghost"}`}>{skill.consented ? tx("已允許", "Allowed") : tx("未允許", "Not allowed")}</span>
                  {oauth && <span className={`s-tag ${skill.connected ? "mint" : "ghost"}`}>{skill.connected ? tx("已連接", "Connected") : tx("未連接", "Not connected")}</span>}
                </span>
              </div>
              <div className="s-row">{skill.tools.map(tool => <span className="s-tag ghost" key={tool}>{tool}</span>)}</div>
              <div className="s-row">
                {skill.consented
                  ? <button type="button" className="s-btn" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: false })}>{tx("撤回", "Revoke")}</button>
                  : <button type="button" className="s-btn s-primary" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: true })}>{tx("允許唯讀使用", "Allow read-only")}</button>}
                {oauth && skill.consented && !skill.connected && (
                  <button type="button" className="s-btn s-primary" disabled={connect.isPending} onClick={() => connect.mutate(skill.id)}>
                    {connect.isPending ? tx("連接中…", "Connecting…") : tx("連接帳戶", "Connect account")}
                  </button>
                )}
                {oauth && skill.connected && (
                  <button type="button" className="s-btn" disabled={disconnect.isPending} onClick={() => disconnect.mutate(skill.id)}>{tx("中斷連接", "Disconnect")}</button>
                )}
              </div>
              {failure && <small>{tx("未能更新技能狀態，請再試一次。", "Could not update the skill. Try again.")}</small>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
