import type { AcademyKind } from "@/lib/academy";

type Metadata = Record<string, unknown>;
function object(value: unknown): Metadata {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Metadata : {};
}
function localized(value: unknown, lang: "zh" | "en"): string {
  return typeof value === "string" ? value : typeof object(value)[lang] === "string" ? object(value)[lang] as string : "";
}
function withLanguage(value: unknown, lang: "zh" | "en", text: string) {
  return { zh: "", en: "", ...(typeof value === "string" ? { zh: value, en: value } : object(value)), [lang]: text };
}

export class AcademyIdeaRebaseError extends Error {
  constructor() { super("Idea rows changed; your draft and latest comparison are preserved. Compare each language before saving. / 內容點子次序或數量有變，已保留草稿及最新比較，請逐項核對中英文。"); }
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function rebaseIdeas(draft: unknown, baseline: unknown, latest: unknown): unknown {
  if (equal(draft, latest) || equal(latest, baseline)) return draft;
  if (!Array.isArray(draft) || !Array.isArray(baseline) || !Array.isArray(latest)
    || draft.length !== baseline.length || latest.length !== baseline.length) throw new AcademyIdeaRebaseError();
  // Legacy rows have no IDs. Only merge a changed row when an unchanged, unique
  // translation still identifies the same row; never infer identity after a reorder.
  const aligned = (row: unknown, index: number) => (["zh", "en"] as const).some(lang => {
    const anchor = localized(baseline[index], lang);
    return anchor !== "" && localized(row, lang) === anchor
      && baseline.filter(original => localized(original, lang) === anchor).length === 1;
  });
  const translated = (row: unknown) => typeof row === "string" ? { zh: row, en: row } : object(row);
  return draft.map((row, index) => {
    if (equal(row, baseline[index])) return latest[index];
    if (equal(latest[index], baseline[index])) return row;
    if (!aligned(row, index) || !aligned(latest[index], index)) throw new AcademyIdeaRebaseError();
    return rebaseAcademyMetadata(translated(row), translated(baseline[index]), translated(latest[index]));
  });
}

/** Carry forward only authored changes, including individual translated metadata fields. */
export function rebaseAcademyMetadata(draft: Metadata, baseline: Metadata, latest: Metadata): Metadata {
  const merged = { ...latest };
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value) === JSON.stringify(baseline[key])) continue;
    if (key === "ideas") { merged[key] = rebaseIdeas(value, baseline[key], latest[key]); continue; }
    const nested = value !== null && typeof value === "object" && !Array.isArray(value);
    // A legacy plain string was displayed in both languages. Compare against that
    // same baseline so converting it to localized fields does not author the other language.
    const translated = nested && ("zh" in object(value) || "en" in object(value));
    const original = translated && typeof baseline[key] === "string" ? { zh: baseline[key], en: baseline[key] } : object(baseline[key]);
    const current = translated && typeof latest[key] === "string" ? { zh: latest[key], en: latest[key] } : object(latest[key]);
    merged[key] = nested ? rebaseAcademyMetadata(object(value), original, current) : value;
  }
  return merged;
}

export function AcademyMetadataFields({ kind, lang, metadata, onChange }: {
  kind: AcademyKind; lang: "zh" | "en"; metadata: Metadata; onChange: (metadata: Metadata) => void;
}) {
  const suffix = lang === "zh" ? "中文" : "EN";
  const inputClass = "mt-1 w-full rounded border-2 border-[var(--color-ink)] p-2 text-sm";
  const translated = (key: string, label: string) => <label className="block text-sm" key={key}>{label} ({suffix})
    <input className={inputClass} value={localized(metadata[key], lang)} maxLength={400}
      onChange={e => onChange({ ...metadata, [key]: withLanguage(metadata[key], lang, e.target.value) })} />
  </label>;
  if (kind === "track") return <section aria-label="Course details / 課程資料" className="space-y-3">
    {translated("duration", "Learning time")}
    {translated("levelLabel", "Level label")}
    <label className="block text-sm">Course preview ({suffix})
      <textarea className={inputClass} rows={3} maxLength={2000} value={typeof metadata[`teaser_${lang}`] === "string" ? metadata[`teaser_${lang}`] as string : ""}
        onChange={e => onChange({ ...metadata, [`teaser_${lang}`]: e.target.value })} />
    </label>
  </section>;
  if (kind === "resource") return <section aria-label="Resource details / 資源資料" className="space-y-3">
    {([['type', 'Resource format / 資源格式'], ['fileUrl', 'Download link / 下載連結']] as const).map(([key,label]) => <label className="block text-sm" key={key}>{label}
      <input className={inputClass} value={typeof metadata[key] === "string" ? metadata[key] as string : ""}
        onChange={e => onChange({ ...metadata, [key]: e.target.value })} />
    </label>)}
  </section>;
  if (kind === "playbook") return <section aria-label="Playbook details / 創作指南資料" className="space-y-3">
    {translated("creatorAngle", "Creator approach")}
    {translated("measurementFocus", "Measurement focus")}
    <fieldset className="space-y-2"><legend>Suitable levels / 適用等級</legend>
      {["L0","L1","L2","L3","L4","L5","L6"].map(level => <label className="mr-3 inline-flex items-center gap-1" key={level}>
        <input type="checkbox" checked={Array.isArray(metadata.levels) && metadata.levels.includes(level)} onChange={e => {
          const levels = Array.isArray(metadata.levels) ? metadata.levels : [];
          onChange({ ...metadata, levels: e.target.checked ? [...levels, level] : levels.filter(v => v !== level) });
        }} />{level}
      </label>)}
    </fieldset>
    <fieldset className="space-y-3"><legend>Content ideas ({suffix})</legend>
      {(Array.isArray(metadata.ideas) ? metadata.ideas : []).map((idea, index) => <div key={index} className="space-y-2 rounded border p-2">
        <label className="block text-sm">Content idea {index + 1} ({suffix})
          <textarea className={inputClass} rows={3} value={localized(idea, lang)} onChange={e => {
            const ideas = [...metadata.ideas as unknown[]];
            ideas[index] = withLanguage(idea, lang, e.target.value);
            onChange({ ...metadata, ideas });
          }} />
        </label>
        <button type="button" aria-label={`Remove content idea ${index + 1} in both languages`} className="min-h-11 underline"
          onClick={() => onChange({ ...metadata, ideas: (metadata.ideas as unknown[]).filter((_, position) => position !== index) })}>
          Remove idea in both languages / 移除中英文項目
        </button>
      </div>)}
      <button type="button" className="min-h-11 underline" onClick={() => onChange({ ...metadata, ideas: [...(Array.isArray(metadata.ideas) ? metadata.ideas : []), { zh: "", en: "" }] })}>Add content idea</button>
    </fieldset>
  </section>;
  return null;
}
