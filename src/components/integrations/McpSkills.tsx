import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useStudioText } from "@/components/studio/StudioPrimitives";

type McpSkill = { id: string; name: string; tools: string[]; consented: boolean };
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

  const hiddenError = list.error instanceof ApiError ? [401, 403, 404, 503].includes(list.error.status) : Boolean(list.error);
  if (hiddenError || !list.data?.available || !list.data.skills.length) return null;

  return (
    <section className="s-card s-stack" aria-label={tx("資料技能", "Data skills")}>
      <div className="s-between">
        <div>
          <span className="s-eyebrow">MCP SKILLS</span>
          <h2>{tx("資料技能", "Data skills")}</h2>
        </div>
        <span className="s-tag ghost">{tx("只讀", "Read only")}</span>
      </div>
      <p className="s-muted">
        {tx("由工作區擁有者加入的只讀技能。只有在你同意後，聊天才會讀取該伺服器。", "Read-only skills added by the workspace owner. Chat only reads a server after you allow it.")}
      </p>
      <div className="s-stack">
        {list.data.skills.map(skill => (
          <article className="s-card s-stack" key={skill.id} aria-label={skill.name}>
            <div className="s-between">
              <h3>{skill.name}</h3>
              <span className={`s-tag ${skill.consented ? "mint" : "ghost"}`}>{skill.consented ? tx("已同意", "Allowed") : tx("未同意", "Not allowed")}</span>
            </div>
            <div className="s-row">{skill.tools.map(tool => <span className="s-tag ghost" key={tool}>{tool}</span>)}</div>
            <div className="s-row">
              {skill.consented
                ? <button type="button" className="s-btn" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: false })}>{tx("撤回同意", "Revoke")}</button>
                : <button type="button" className="s-btn s-primary" disabled={consent.isPending} onClick={() => consent.mutate({ id: skill.id, grant: true })}>{tx("允許只讀使用", "Allow read-only")}</button>}
            </div>
            {consent.isError && consent.variables?.id === skill.id && <small>{tx("未能更新同意狀態，請再試一次。", "Could not update consent. Try again.")}</small>}
          </article>
        ))}
      </div>
    </section>
  );
}
