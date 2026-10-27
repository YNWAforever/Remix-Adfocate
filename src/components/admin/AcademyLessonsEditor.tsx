import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminLessonKey, getAdminLessons, saveLesson, lessonAction, type AdminLesson, type LessonDraft } from "@/lib/academyProgress";
import { ApiError } from "@/lib/api";
import { Markdown } from "../Markdown";
const empty: LessonDraft = { title_zh: "", title_en: "", body_zh: "", body_en: "", position: 0 };
const values = (row: LessonDraft): LessonDraft => ({ title_zh: row.title_zh, title_en: row.title_en, body_zh: row.body_zh, body_en: row.body_en, position: row.position });

export function AcademyLessonsEditor({ trackId, lang }: { trackId: string; lang: "zh" | "en" }) {
  const qc = useQueryClient(), key = adminLessonKey(trackId);
  const query = useQuery({ queryKey: key, queryFn: () => getAdminLessons(trackId), retry: false });
  const [editing, setEditing] = useState(false), [selected, setSelected] = useState<AdminLesson | null>(null);
  const [form, setForm] = useState<LessonDraft>(empty), [approval, setApproval] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(selected ? values(selected) : empty);
  const update = (patch: Partial<LessonDraft>) => setForm(old => ({ ...old, ...patch }));
  const saved = (row: AdminLesson) => { setSelected(row); setForm(values(row)); setApproval(""); qc.invalidateQueries({ queryKey: key }); };
  const save = useMutation({ mutationFn: () => saveLesson(trackId, form, selected), onSuccess: ({ item }) => saved(item) });
  const action = useMutation({ mutationFn: (type: "publish" | "archive") => lessonAction(trackId, selected!, type, approval), onSuccess: ({ item }) => saved(item) });
  const busy = save.isPending || action.isPending;
  const error = save.error ?? action.error;
  const conflict = error instanceof ApiError && error.status === 409;
  const latest = query.data?.items.find(row => row.id === selected?.id && row.content_version === selected.content_version);
  function choose(row: AdminLesson | null) {
    if (dirty && !window.confirm("Discard unsaved lesson edits? 放棄未儲存的單元修改？")) return;
    setEditing(true); setSelected(row); setForm(row ? values(row) : empty); setApproval(""); save.reset(); action.reset();
  }
  function rebase() {
    if (!latest || !selected || latest.status === "archived") return;
    const next = values(latest);
    for (const k of Object.keys(empty) as (keyof LessonDraft)[]) if (form[k] !== selected[k]) Object.assign(next, { [k]: form[k] });
    setSelected(latest); setForm(next); save.reset(); action.reset();
  }
  const titleKey = lang === "zh" ? "title_zh" : "title_en", bodyKey = lang === "zh" ? "body_zh" : "body_en";
  return <section className="space-y-3 rounded border-2 border-[var(--color-ink)] p-3" aria-label="Lesson authoring">
    <h3 className="font-heading font-bold">課程單元 · Lessons</h3>
    <p className="text-sm">只發布已核准教材並提供核准 reference。沒有教材請維持草稿。 Published lessons require approved material and its reference.</p>
    {query.isPending && <p role="status">載入單元中… Loading lessons…</p>}
    {query.isError && <div role="alert"><p>單元列表載入失敗，原有輸入仍保留。 Lesson list unavailable; draft preserved.</p><button onClick={() => query.refetch()}>Retry lesson list</button></div>}
    <ul className="space-y-2">{query.data?.items.map(row => <li key={`${row.id}:${row.content_version}`}>
      <button type="button" disabled={busy} onClick={() => choose(row)} className="underline">
        {row.title_zh || "Untitled lesson"} · v{row.content_version} · {row.status} · {row.position}
      </button>
    </li>)}</ul>
    <button type="button" disabled={busy || query.isError} onClick={() => choose(null)} className="btn-ink">New lesson</button>
    {editing && <fieldset disabled={busy} className="space-y-3 border-t-2 border-dashed pt-3">
      {selected && <p>v{selected.content_version} · {selected.status} · revision {selected.revision}</p>}
      {error && <div role="alert"><p>{conflict ? "版本有更新，請重新載入列表比較；草稿仍保留。 Another revision exists; reload to compare." : "單元未能儲存或發布，輸入仍保留，可重試。 Lesson save/publish failed; draft preserved."} {error.message}</p></div>}
      {conflict && <div className="space-y-2">
        <button onClick={() => query.refetch()}>Compare latest lesson</button>
        {latest && <details><summary>Latest lesson revision {latest.revision}</summary><Markdown source={latest[bodyKey]} /></details>}
        {latest && latest.status !== "archived" && <button onClick={rebase}>Keep draft on latest revision</button>}
      </div>}
      <label className="block text-sm">Lesson title ({lang === "zh" ? "中文" : "EN"})
        <input className="block w-full rounded border-2 p-2" value={form[titleKey]} onChange={e => update({ [titleKey]: e.target.value })} disabled={selected?.status === "archived"} />
      </label>
      <label className="block text-sm">Lesson body ({lang === "zh" ? "中文" : "EN"})
        <textarea className="block w-full rounded border-2 p-2 font-mono" rows={10} value={form[bodyKey]} onChange={e => update({ [bodyKey]: e.target.value })} disabled={selected?.status === "archived"} />
      </label>
      <label className="block text-sm">Lesson position
        <input type="number" min={0} max={10000} className="ml-2 rounded border-2 p-1" value={form.position} onChange={e => update({ position: Number(e.target.value) })} disabled={selected?.status === "archived"} />
      </label>
      <div className="rounded border-2 border-dashed p-3"><p className="text-xs">Lesson preview</p><Markdown source={form[bodyKey]} /></div>
      {selected?.status !== "archived" && <button type="button" onClick={() => save.mutate()} className="btn-primary">{selected?.status === "published" ? "Save as new version" : "Save lesson"}</button>}
      {selected?.status === "draft" && <>
        <label className="block text-sm">Approval reference
          <input className="block w-full rounded border-2 p-2" value={approval} maxLength={500} onChange={e => setApproval(e.target.value)} />
        </label>
        <button type="button" disabled={dirty || !approval.trim()} onClick={() => action.mutate("publish")} className="btn-primary disabled:opacity-50">Publish lesson</button>
        {dirty && <p className="text-sm">先儲存單元修改，再發布。 Save lesson changes before publishing.</p>}
      </>}
      {selected && selected.status !== "archived" && <button type="button" disabled={dirty} onClick={() => action.mutate("archive")} className="ml-2 underline">Archive lesson</button>}
    </fieldset>}
  </section>;
}
