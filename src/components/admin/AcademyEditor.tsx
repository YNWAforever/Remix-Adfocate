import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/components/Markdown";
import { AcademyLessonsEditor } from "./AcademyLessonsEditor";
import { AcademyMetadataFields, rebaseAcademyMetadata } from "./AcademyMetadataFields";
import {
  getAdminAcademy, createAcademy, updateAcademy, academyAction, academyKeys,
  type AdminAcademyRow, type AcademyKind,
} from "@/lib/academy";

const EMPTY: Partial<AdminAcademyRow> = {
  kind: "guide_doc", slug: "", title_zh: "", title_en: "", body_zh: "", body_en: "",
  excerpt_zh: "", excerpt_en: "", category: null, required_level: null, emoji: "", color: "", sort: 0, metadata: {},
};
const KINDS: AcademyKind[] = ["guide_doc", "track", "playbook", "resource"];
const EDIT_FIELDS: (keyof AdminAcademyRow)[] = ["kind", "slug", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en", "category", "required_level", "emoji", "color", "sort", "metadata"];
function editedFields(form: Partial<AdminAcademyRow>, baseline: Partial<AdminAcademyRow>) {
  const patch: Partial<AdminAcademyRow> = {};
  for (const key of EDIT_FIELDS) {
    if (JSON.stringify(form[key]) !== JSON.stringify(baseline[key])) Object.assign(patch, { [key]: form[key] });
  }
  return patch;
}

export function AcademyEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [form, setForm] = useState<Partial<AdminAcademyRow>>(EMPTY);
  const baseline = useRef<Partial<AdminAcademyRow>>(EMPTY);

  const existing = useQuery({
    queryKey: academyKeys.adminItem(id), enabled: !isNew,
    queryFn: async () => (await getAdminAcademy(id)).item,
  });

  // Seed only when the record identity changes: a background refetch (window focus) must never
  // overwrite the draft the operator is typing into.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    const row = existing.data;
    if (!row || seeded.current === row.id) return;
    seeded.current = row.id;
    baseline.current = row;
    setForm(row);
  }, [existing.data]);

  const set = (patch: Partial<AdminAcademyRow>) => setForm((f) => ({ ...f, ...patch }));
  const titleField = lang === "zh" ? "title_zh" : "title_en";
  const bodyField = lang === "zh" ? "body_zh" : "body_en";
  const showBody = KINDS.includes(form.kind as AcademyKind);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, metadata: form.metadata ?? {} };
      if (isNew) return (await createAcademy(payload)).item;
      return (await updateAcademy(id, { ...editedFields(payload, baseline.current), updated_at: baseline.current.updated_at })).item;
    },
    onSuccess: (item) => {
      baseline.current = item;
      qc.invalidateQueries({ queryKey: ["admin", "academy"] });
      if (isNew) navigate({ to: "/admin/academy/$id", params: { id: item.id } });
      else setForm(item);
    },
  });
  const act = useMutation({
    mutationFn: (a: "publish" | "unpublish" | "archive") => academyAction(id, a),
    onSuccess: ({ item }) => { baseline.current = item; setForm(item); qc.invalidateQueries({ queryKey: ["admin", "academy"] }); },
  });
  const comparison = useMutation({ mutationFn: () => getAdminAcademy(id) });
  const busy = save.isPending || act.isPending || comparison.isPending;
  const mutationError = save.error ?? act.error;
  const conflict = save.error && "status" in save.error && save.error.status === 409;
  const unsaved = JSON.stringify(form) !== JSON.stringify(baseline.current);

  function keepDraftOnLatest() {
    const latest = comparison.data?.item;
    if (!latest) return;
    const rebased = { ...latest, ...editedFields(form, baseline.current),
      metadata: rebaseAcademyMetadata(form.metadata ?? {}, baseline.current.metadata ?? {}, latest.metadata ?? {}) };
    baseline.current = latest;
    setForm(rebased);
    save.reset(); comparison.reset();
  }

  if (!isNew && !existing.data) return (
    <div role={existing.isError ? "alert" : "status"}>
      {existing.isError ? <><p>內容載入失敗，請重試。 Failed to load content.</p><button onClick={() => existing.refetch()}>Retry</button></> : "載入中… Loading…"}
    </div>
  );

  return (
    <fieldset disabled={busy} className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-3">
        {mutationError && <p role="alert" className="text-sm text-[var(--color-magenta)]">儲存或發布失敗，輸入仍保留，可重試。 Save or publish failed; your draft is preserved. {mutationError.message}</p>}
        {conflict && <div className="space-y-2 border-2 border-[var(--color-ink)] p-3">
          <p>版本有更新。請比較最新內容，確認後再儲存你的改動。 Another version exists; compare it before retrying.</p>
          <button type="button" onClick={() => comparison.mutate()}>Compare latest</button>
          {comparison.error && <p role="alert">載入失敗，可重試。 {comparison.error.message}</p>}
          {comparison.data && <>
            <dl className="space-y-2 break-words text-sm">
              <dt>Latest title / 最新標題</dt><dd>{comparison.data.item[lang === "zh" ? "title_zh" : "title_en"]}</dd>
              <dt>Latest body / 最新正文</dt><dd className="whitespace-pre-wrap">{comparison.data.item[lang === "zh" ? "body_zh" : "body_en"]}</dd>
              <dt>Latest learning time / 最新學習時間</dt><dd>{typeof comparison.data.item.metadata.duration === "string" ? comparison.data.item.metadata.duration : String((comparison.data.item.metadata.duration as Record<string, unknown> | undefined)?.[lang] ?? "")}</dd>
            </dl>
            <p>確認後會保留你修改的欄位；未修改欄位沿用最新版本。 Only your edited fields will be carried forward.</p>
            <button type="button" onClick={keepDraftOnLatest}>Keep my edits on this revision</button>
          </>}
        </div>}
        <div className="flex items-center gap-2">
          <button onClick={() => setLang("zh")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "zh" ? "bg-[var(--color-ink)] text-white" : ""}`}>中文</button>
          <button onClick={() => setLang("en")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "en" ? "bg-[var(--color-ink)] text-white" : ""}`}>EN</button>
          {!isNew && <span className="ml-auto text-xs">{form.status}</span>}
        </div>
        <label className="block text-sm">Title ({lang === "zh" ? "中文" : "EN"})
          <input value={(form[titleField] as string) ?? ""} onChange={(e) => set({ [titleField]: e.target.value })} disabled={busy}
            placeholder="Title" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-lg font-bold" />
        </label>
        <label className="block text-sm">Excerpt ({lang === "zh" ? "中文" : "EN"})
          <input value={(form[lang === "zh" ? "excerpt_zh" : "excerpt_en"] as string) ?? ""} onChange={(e) => set({ [lang === "zh" ? "excerpt_zh" : "excerpt_en"]: e.target.value })} disabled={busy}
            placeholder="Excerpt / short description" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
        </label>
        {showBody && (
          <>
            <label className="block text-sm">Body ({lang === "zh" ? "中文" : "EN"})
              <textarea value={(form[bodyField] as string) ?? ""} onChange={(e) => set({ [bodyField]: e.target.value })} disabled={busy}
                placeholder="Markdown…" rows={12} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm" />
            </label>
            <div className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
              <p className="mb-1 text-xs uppercase">Preview</p>
              <Markdown source={(form[bodyField] as string) ?? ""} />
            </div>
          </>
        )}
        <AcademyMetadataFields kind={form.kind ?? "guide_doc"} lang={lang} metadata={form.metadata ?? {}} onChange={metadata => set({ metadata })} />
        {!isNew && form.kind === "track" && <AcademyLessonsEditor key={id} trackId={id} lang={lang} />}
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
        <button disabled={busy} onClick={() => save.mutate()} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-2 font-bold">Save</button>
        {!isNew && unsaved && <p className="text-sm">請先儲存改動。 Save changes before publishing or archiving.</p>}
        {!isNew && form.status !== "published" && <button disabled={busy || unsaved} onClick={() => act.mutate("publish")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-bold">Publish</button>}
        {!isNew && form.status === "published" && <button disabled={busy || unsaved} onClick={() => act.mutate("archive")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm">Archive</button>}
      </aside>
    </fieldset>
  );
}
