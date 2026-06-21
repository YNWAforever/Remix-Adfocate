// src/components/admin/MissionEditor.tsx
import { useState } from "react";
import { MISSION_CATEGORIES } from "@/lib/missionCategories";
import { AdminRequestError, type AdminMission, type MissionDraftInput } from "@/lib/admin";

const MISSION_TYPES = ["koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador"] as const;
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
const EFFORTS = ["", "low", "medium", "high"] as const;

type Mode = "create" | "edit";
type Props = {
  mode: Mode;
  initial?: AdminMission;
  workspaces?: { id: string; name: string }[];
  engaged?: boolean;
  onSave: (body: MissionDraftInput) => Promise<unknown>;
  saving?: boolean;
};

const toLines = (a?: string[] | null) => (a ?? []).join("\n");
const fromLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function MissionEditor({ mode, initial, workspaces = [], engaged = false, onSave, saving }: Props) {
  const published = mode === "edit" && initial?.status !== "draft";
  const [f, setF] = useState({
    workspace_id: initial?.workspace_id ?? workspaces[0]?.id ?? "",
    slug: initial?.slug ?? "",
    title: initial?.title ?? "",
    mission_type: initial?.mission_type ?? "ugc",
    description: initial?.description ?? "",
    category: initial?.category ?? "",
    access_type: initial?.access_type ?? "open",
    required_level: initial?.required_level ?? "L0",
    points_reward: String(initial?.points_reward ?? ""),
    cash_reward: initial?.cash_reward != null ? String(initial.cash_reward) : "",
    cpm_rate: initial?.cpm_rate != null ? String(initial.cpm_rate) : "",
    cpm_budget_pool: initial?.cpm_budget_pool != null ? String(initial.cpm_budget_pool) : "",
    deadline: initial?.deadline ?? "",
    quota: String(initial?.quota ?? "10"),
    deliverables: toLines(initial?.deliverables),
    requirements: toLines(initial?.requirements),
    platforms: toLines(initial?.platforms),
    effort: initial?.effort ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const isCpm = f.mission_type === "performance_cpm";

  const submit = async () => {
    setErrors({});
    const body: MissionDraftInput = {
      workspace_id: f.workspace_id, slug: f.slug, title: f.title, mission_type: f.mission_type,
      description: f.description || null, category: f.category || null,
      access_type: f.access_type as "open" | "application", required_level: f.required_level,
      // Off-type reward fields are nulled on save so no stale values persist.
      points_reward: isCpm ? 0 : Number(f.points_reward || 0),
      cash_reward: isCpm ? null : numOrNull(f.cash_reward),
      cpm_rate: isCpm ? numOrNull(f.cpm_rate) : null,
      cpm_budget_pool: isCpm ? numOrNull(f.cpm_budget_pool) : null,
      deadline: f.deadline || null, quota: Number(f.quota || 0),
      deliverables: fromLines(f.deliverables), requirements: fromLines(f.requirements), platforms: fromLines(f.platforms),
      effort: (f.effort || null) as MissionDraftInput["effort"],
    };
    try {
      await onSave(body);
    } catch (e) {
      if (e instanceof AdminRequestError && e.fields) setErrors(e.fields);
      else window.alert(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="text-xs font-bold text-red-600">{errors[k]}</p> : null);
  const input = "h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm disabled:opacity-50";
  const area = "w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm";
  const lockNote = (reason: string) => <span className="ml-2 text-xs text-[var(--color-soft-ink)]">{reason}</span>;

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">基本</h2>
        <label className="block text-sm">品牌
          <select aria-label="品牌" className={input} value={f.workspace_id} disabled={mode === "edit"} onChange={set("workspace_id")}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">標題 (zh-HK)
          <input aria-label="標題" className={input} value={f.title} onChange={set("title")} /><Err k="title" />
        </label>
        <label className="block text-sm">Slug (english){published ? lockNote("已發佈：不可更改") : null}
          <input aria-label="Slug" className={input} value={f.slug} disabled={published} onChange={set("slug")} /><Err k="slug" />
        </label>
        <label className="block text-sm">分類
          <select aria-label="分類" className={input} value={f.category} onChange={set("category")}>
            <option value="">— 選擇 —</option>
            {MISSION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select><Err k="category" />
        </label>
        <label className="block text-sm">任務類型{published ? lockNote("已發佈：不可更改") : null}
          <select aria-label="任務類型" className={input} value={f.mission_type} disabled={published} onChange={set("mission_type")}>
            {MISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select><Err k="mission_type" />
        </label>
        <label className="block text-sm">參與方式{engaged ? lockNote("已鎖定") : null}
          <select aria-label="參與方式" className={input} value={f.access_type} disabled={engaged} onChange={set("access_type")}>
            <option value="open">公開 (open)</option>
            <option value="application">申請制 (application)</option>
          </select><Err k="access_type" />
        </label>
        <label className="block text-sm">等級要求{engaged ? lockNote("已鎖定") : null}
          <select aria-label="等級要求" className={input} value={f.required_level} disabled={engaged} onChange={set("required_level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select><Err k="required_level" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">獎勵{engaged ? lockNote("已鎖定") : null}</h2>
        {isCpm ? (
          <>
            <label className="block text-sm">CPM 單價
              <input aria-label="CPM 單價" className={input} type="number" value={f.cpm_rate} disabled={engaged} onChange={set("cpm_rate")} /><Err k="cpm_rate" />
            </label>
            <label className="block text-sm">預算池
              <input aria-label="預算池" className={input} type="number" value={f.cpm_budget_pool} disabled={engaged} onChange={set("cpm_budget_pool")} /><Err k="cpm_budget_pool" />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">積分獎勵
              <input aria-label="積分獎勵" className={input} type="number" value={f.points_reward} disabled={engaged} onChange={set("points_reward")} /><Err k="points_reward" />
            </label>
            <label className="block text-sm">現金獎勵 (HK$)
              <input aria-label="現金獎勵" className={input} type="number" value={f.cash_reward} disabled={engaged} onChange={set("cash_reward")} /><Err k="cash_reward" />
            </label>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">名額與期限</h2>
        <label className="block text-sm">名額{engaged ? lockNote(`不可低於已參與人數 (${initial?.filled ?? 0})`) : null}
          <input aria-label="名額" className={input} type="number" min={engaged ? initial?.filled ?? 1 : 1} value={f.quota} onChange={set("quota")} /><Err k="quota" />
        </label>
        <label className="block text-sm">截止日期{engaged ? lockNote("只可延後") : null}
          <input aria-label="截止日期" className={input} type="date" value={f.deadline} onChange={set("deadline")} /><Err k="deadline" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">簡介</h2>
        <label className="block text-sm">任務簡介
          <textarea aria-label="任務簡介" rows={4} className={area} value={f.description} onChange={set("description")} /><Err k="description" />
        </label>
        <label className="block text-sm">交付項目（每行一項）
          <textarea aria-label="交付項目" rows={3} className={area} value={f.deliverables} onChange={set("deliverables")} />
        </label>
        <label className="block text-sm">要求（每行一項）
          <textarea aria-label="要求" rows={3} className={area} value={f.requirements} onChange={set("requirements")} />
        </label>
        <label className="block text-sm">平台（每行一個）
          <textarea aria-label="平台" rows={2} className={area} value={f.platforms} onChange={set("platforms")} />
        </label>
        <label className="block text-sm">投入程度
          <select aria-label="投入程度" className={input} value={f.effort} onChange={set("effort")}>
            {EFFORTS.map((e) => <option key={e} value={e}>{e === "" ? "— 不指定 —" : e}</option>)}
          </select><Err k="effort" />
        </label>
      </section>

      <button onClick={submit} disabled={saving} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-2 font-heading font-bold">
        {mode === "create" ? "儲存草稿" : "儲存變更"}
      </button>
    </div>
  );
}
