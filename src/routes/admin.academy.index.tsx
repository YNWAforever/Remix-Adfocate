import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAdminAcademy, academyKeys } from "@/lib/academy";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/academy/")({ component: AcademyList });

function AcademyList() {
  const { t } = useI18n();
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({ queryKey: academyKeys.adminList(kind || "all"), queryFn: () => listAdminAcademy(kind) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t("app.admin.academy.title")}</h2>
        <Link to="/admin/academy/$id" params={{ id: "new" }} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1.5 text-sm font-bold">
          {t("app.admin.academy.new")}
        </Link>
      </div>
      <select aria-label="Content kind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1 text-sm">
        <option value="">All</option><option value="guide_doc">Guide docs</option><option value="track">Tracks</option><option value="playbook">Playbooks</option><option value="resource">Resources</option>
      </select>
      {isLoading ? <p className="text-sm text-[var(--color-soft-ink)]">…</p>
        : !data?.items.length ? <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.academy.empty")}</p>
        : (
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b-2 border-[var(--color-ink)] text-left text-xs uppercase"><th className="p-2">Title</th><th className="p-2">Kind</th><th className="p-2">Status</th><th /></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-b border-gray-200">
                  <td className="p-2">{it.emoji} {it.title_zh}</td>
                  <td className="p-2">{it.kind}</td>
                  <td className="p-2">{it.status}</td>
                  <td className="p-2"><Link to="/admin/academy/$id" params={{ id: it.id }} className="underline">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
