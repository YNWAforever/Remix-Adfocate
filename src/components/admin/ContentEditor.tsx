import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/components/Markdown";
import {
  getAdminContent, createContent, updateContent, contentAction,
  listCategories, uploadContentImage, contentKeys, type AdminContentRow,
} from "@/lib/content";

const EMPTY: Partial<AdminContentRow> = { kind: "article", title_zh: "", body_zh: "", title_en: "", body_en: "" };

export function ContentEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [form, setForm] = useState<Partial<AdminContentRow>>(EMPTY);

  useQuery({
    queryKey: contentKeys.adminItem(id), enabled: !isNew,
    queryFn: async () => { const { item } = await getAdminContent(id); setForm(item); return item; },
  });
  const cats = useQuery({ queryKey: contentKeys.categories(), queryFn: listCategories });

  const set = (patch: Partial<AdminContentRow>) => setForm((f) => ({ ...f, ...patch }));
  const titleField = lang === "zh" ? "title_zh" : "title_en";
  const bodyField = lang === "zh" ? "body_zh" : "body_en";

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return (await createContent(form)).item;
      return (await updateContent(id, { ...form, updated_at: form.updated_at })).item;
    },
    onSuccess: (item) => { qc.invalidateQueries({ queryKey: ["admin", "content"] }); if (isNew) navigate({ to: "/admin/content/$id", params: { id: item.id } }); else setForm(item); },
  });
  const act = useMutation({
    mutationFn: (a: "publish" | "unpublish" | "archive") => contentAction(id, a),
    onSuccess: ({ item }) => { setForm(item); qc.invalidateQueries({ queryKey: ["admin", "content"] }); },
  });

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadContentImage(file);
    set({ body_zh: `${form.body_zh ?? ""}\n\n![](${url})` });
  }

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
        <textarea value={(form[bodyField] as string) ?? ""} onChange={(e) => set({ [bodyField]: e.target.value })}
          placeholder="Markdown…" rows={14} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm" />
        <div className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
          <p className="mb-1 text-xs uppercase">Preview</p>
          <Markdown source={(form[bodyField] as string) ?? ""} />
        </div>
      </div>
      <aside className="space-y-3">
        <label className="block text-xs uppercase">Kind
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value as AdminContentRow["kind"] })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            <option value="article">Article</option><option value="announcement">Announcement</option>
          </select>
        </label>
        <label className="block text-xs uppercase">Category
          <select value={form.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            <option value="">—</option>{cats.data?.categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.label_zh}</option>)}
          </select>
        </label>
        <label className="block text-xs uppercase">Cover image<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set({ cover_image_url: await uploadContentImage(f) }); }} className="mt-1 block w-full text-xs" /></label>
        {form.cover_image_url && <img src={form.cover_image_url} alt="" className="rounded border-2 border-[var(--color-ink)]" />}
        <label className="block text-xs uppercase">Insert body image<input type="file" accept="image/*" onChange={onImage} className="mt-1 block w-full text-xs" /></label>
        <label className="flex items-center gap-2 text-xs uppercase"><input type="checkbox" checked={!!form.pinned} onChange={(e) => set({ pinned: e.target.checked, pinned_rank: e.target.checked ? 0 : null })} /> Pin to feed</label>
        <button onClick={() => save.mutate()} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-2 font-bold">Save</button>
        {!isNew && form.status !== "published" && <button onClick={() => act.mutate("publish")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-bold">Publish</button>}
        {!isNew && form.status === "published" && <button onClick={() => act.mutate("archive")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm">Archive</button>}
      </aside>
    </div>
  );
}
