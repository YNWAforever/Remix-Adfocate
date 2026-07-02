import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/components/Markdown";
import {
  getAdminAcademy, createAcademy, updateAcademy, academyAction, academyKeys,
  type AdminAcademyRow, type AcademyKind,
} from "@/lib/academy";

const EMPTY: Partial<AdminAcademyRow> = {
  kind: "guide_doc", slug: "", title_zh: "", title_en: "", body_zh: "", body_en: "",
  excerpt_zh: "", excerpt_en: "", category: null, required_level: null, emoji: "", color: "", sort: 0, metadata: {},
};
const KINDS: AcademyKind[] = ["guide_doc", "track", "playbook", "resource"];

export function AcademyEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [form, setForm] = useState<Partial<AdminAcademyRow>>(EMPTY);
  const [metaText, setMetaText] = useState("{}");
  const [metaErr, setMetaErr] = useState<string | null>(null);

  useQuery({
    queryKey: academyKeys.adminItem(id), enabled: !isNew,
    queryFn: async () => {
      const { item } = await getAdminAcademy(id);
      setForm(item); setMetaText(JSON.stringify(item.metadata ?? {}, null, 2)); return item;
    },
  });

  const set = (patch: Partial<AdminAcademyRow>) => setForm((f) => ({ ...f, ...patch }));
  const titleField = lang === "zh" ? "title_zh" : "title_en";
  const bodyField = lang === "zh" ? "body_zh" : "body_en";
  const showBody = form.kind === "guide_doc" || form.kind === "track";

  function parsedMeta(): Record<string, unknown> | null {
    try { const v = JSON.parse(metaText || "{}"); setMetaErr(null); return v; } catch { setMetaErr("Invalid JSON"); return null; }
  }

  const save = useMutation({
    mutationFn: async () => {
      const metadata = parsedMeta();
      if (metadata === null) throw new Error("metadata");
      const payload = { ...form, metadata };
      if (isNew) return (await createAcademy(payload)).item;
      return (await updateAcademy(id, { ...payload, updated_at: form.updated_at })).item;
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["admin", "academy"] });
      if (isNew) navigate({ to: "/admin/academy/$id", params: { id: item.id } });
      else { setForm(item); setMetaText(JSON.stringify(item.metadata ?? {}, null, 2)); }
    },
  });
  const act = useMutation({
    mutationFn: (a: "publish" | "unpublish" | "archive") => academyAction(id, a),
    onSuccess: ({ item }) => { setForm(item); qc.invalidateQueries({ queryKey: ["admin", "academy"] }); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setLang("zh")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "zh" ? "bg-[var(--color-ink)] text-white" : ""}`}>中文</button>
          <button onClick={() => setLang("en")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "en" ? "bg-[var(--color-ink)] text-white" : ""}`}>EN</button>
          {!isNew && <span className="ml-auto text-xs">{form.status}</span>}
        </div>
        <input value={(form[titleField] as string) ?? ""} onChange={(e) => set({ [titleField]: e.target.value })}
          placeholder="Title" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-lg font-bold" />
        <input value={(form[lang === "zh" ? "excerpt_zh" : "excerpt_en"] as string) ?? ""} onChange={(e) => set({ [lang === "zh" ? "excerpt_zh" : "excerpt_en"]: e.target.value })}
          placeholder="Excerpt / short description" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
        {showBody && (
          <>
            <textarea value={(form[bodyField] as string) ?? ""} onChange={(e) => set({ [bodyField]: e.target.value })}
              placeholder="Markdown…" rows={12} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm" />
            <div className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
              <p className="mb-1 text-xs uppercase">Preview</p>
              <Markdown source={(form[bodyField] as string) ?? ""} />
            </div>
          </>
        )}
        <label className="block text-xs uppercase">Metadata (JSON)
          <textarea value={metaText} onChange={(e) => setMetaText(e.target.value)} rows={8}
            className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-2 font-mono text-xs" />
          {metaErr && <span className="text-xs text-[var(--color-magenta)]">{metaErr}</span>}
        </label>
      </div>
      <aside className="space-y-3">
        <label className="block text-xs uppercase">Kind
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value as AcademyKind })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="block text-xs uppercase">Slug
          <input value={form.slug ?? ""} onChange={(e) => set({ slug: e.target.value })} disabled={!isNew && form.status !== "draft"}
            className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" />
        </label>
        {form.kind === "guide_doc" && (
          <label className="block text-xs uppercase">Category
            <select value={form.category ?? ""} onChange={(e) => set({ category: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
              <option value="">—</option><option value="start">start</option><option value="missions">missions</option><option value="rewards">rewards</option><option value="account">account</option>
            </select>
          </label>
        )}
        {form.kind === "track" && (
          <label className="block text-xs uppercase">Required level
            <select value={form.required_level ?? ""} onChange={(e) => set({ required_level: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
              <option value="">—</option>{["L0","L1","L2","L3","L4","L5","L6"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs uppercase">Emoji<input value={form.emoji ?? ""} onChange={(e) => set({ emoji: e.target.value })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <label className="block text-xs uppercase">Color<input value={form.color ?? ""} onChange={(e) => set({ color: e.target.value })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <label className="block text-xs uppercase">Sort<input type="number" value={form.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <button onClick={() => save.mutate()} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-2 font-bold">Save</button>
        {!isNew && form.status !== "published" && <button onClick={() => act.mutate("publish")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-bold">Publish</button>}
        {!isNew && form.status === "published" && <button onClick={() => act.mutate("archive")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm">Archive</button>}
      </aside>
    </div>
  );
}
