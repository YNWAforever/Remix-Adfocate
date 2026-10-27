import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAdminContent, contentKeys, type ContentStatus } from "@/lib/content";
import { RequestFeedback, canShowPreviousData } from "@/components/RequestFeedback";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/content/")({ component: ContentList });

const STATUS_CHIP: Record<ContentStatus, string> = {
  published: "bg-[#c7f9cc]", scheduled: "bg-[#ffe28a]", draft: "bg-gray-200", archived: "bg-gray-300 text-gray-500",
};

function ContentList() {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const filters: Record<string, string> = status ? { status } : {};
  const q = useQuery({ queryKey: contentKeys.adminList(filters), queryFn: () => listAdminContent(filters), retry: false });
  const data = canShowPreviousData(q.error) ? q.data : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t("app.admin.content.title")}</h2>
        <Link to="/admin/content/$id" params={{ id: "new" }} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1.5 text-sm font-bold">
          {t("app.admin.content.new")}
        </Link>
      </div>
      <select aria-label="Content status / 內容狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1 text-sm">
        <option value="">All</option><option value="draft">Draft</option><option value="scheduled">Scheduled</option>
        <option value="published">Published</option><option value="archived">Archived</option>
      </select>
      <RequestFeedback error={q.error} stale={Boolean(data)} retry={() => void q.refetch()} />
      {q.isLoading ? (
        <p className="text-sm text-[var(--color-soft-ink)]">…</p>
      ) : !q.isError && data?.items.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.content.empty")}</p>
      ) : data?.items.length ? (
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-[var(--color-ink)] text-left text-xs uppercase">
            <th className="p-2">Title</th><th className="p-2">Kind</th><th className="p-2">Status</th><th className="p-2">Views</th><th />
          </tr></thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="p-2">{it.pinned ? "★ " : ""}{it.title_zh}</td>
                <td className="p-2">{it.kind}</td>
                <td className="p-2"><span className={`rounded-full border border-[var(--color-ink)] px-2 text-xs ${STATUS_CHIP[it.status]}`}>{it.status}</span></td>
                <td className="p-2">{it.views || "—"}</td>
                <td className="p-2"><Link to="/admin/content/$id" params={{ id: it.id }} className="underline">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
