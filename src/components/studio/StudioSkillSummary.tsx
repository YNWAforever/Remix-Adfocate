import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useStudioText } from "./StudioPrimitives";

type Skill = { id: string; name: string; tools: string[]; consented: boolean; connected?: boolean; auth_mode?: string };
type SkillList = { available: boolean; skills: Skill[] };

/** Compact skill status inside the evidence tab: data skills are not evidence sources. */
export function StudioSkillSummary() {
  const tx = useStudioText();
  const skills = useQuery({
    queryKey: ["mcp", "skills"],
    queryFn: () => apiFetch<SkillList>("/mcp/skills"),
    retry: false,
    staleTime: 30_000,
  });
  const hiddenError = skills.error instanceof ApiError && [401, 403, 404, 503].includes(skills.error.status);
  if (hiddenError || !skills.data?.available || !skills.data.skills.length) return null;

  return (
    <section className="s-card s-stack" aria-label={tx("資料技能", "Data skills")}>
      <div className="s-between">
        <h3>{tx("資料技能", "Data skills")}</h3>
        <a className="s-btn" href="/connections">{tx("管理", "Manage")}</a>
      </div>
      <div className="s-row">
        {skills.data.skills.map(skill => (
          <span className="s-tag" key={skill.id}>
            {skill.name} · {skill.connected ? tx("已連接", "Connected") : skill.consented ? tx("待連接", "Not connected") : tx("未允許", "Not allowed")}
          </span>
        ))}
      </div>
      <small>{tx("技能會在討論中自動使用，不會列作證據來源。", "Skills run in chat; they are not evidence sources.")}</small>
    </section>
  );
}
