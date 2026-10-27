import type { AcademyKind } from "@/lib/academy";

type Metadata = Record<string, unknown>;
function object(value: unknown): Metadata {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Metadata : {};
}
function localized(value: unknown, lang: "zh" | "en"): string {
  return typeof value === "string" ? value : typeof object(value)[lang] === "string" ? object(value)[lang] as string : "";
}
function withLanguage(value: unknown, lang: "zh" | "en", text: string) {
  return { ...(typeof value === "string" ? { zh: value, en: value } : object(value)), [lang]: text };
}

/** Carry forward only authored changes, including individual translated metadata fields. */
export function rebaseAcademyMetadata(draft: Metadata, baseline: Metadata, latest: Metadata): Metadata {
  const merged = { ...latest };
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value) === JSON.stringify(baseline[key])) continue;
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
    <label className="block text-sm">Content ideas ({suffix})
      <textarea className={inputClass} rows={5} value={Array.isArray(metadata.ideas) ? metadata.ideas.map(v => localized(v, lang)).join("\n") : ""}
        onChange={e => onChange({ ...metadata, ideas: e.target.value.split("\n").map((line,index) => withLanguage(Array.isArray(metadata.ideas) ? metadata.ideas[index] : undefined, lang, line)) })} />
    </label>
  </section>;
  return null;
}
