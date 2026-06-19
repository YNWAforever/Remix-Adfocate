import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminKeys, fetchApplications, fetchSubmissions } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

const TABS = [
  { to: "/admin/applications", label: "申請" },
  { to: "/admin/engaged", label: "活躍創作者" },
  { to: "/admin/submissions", label: "作品審批" },
  { to: "/admin/creators", label: "創作者審核" },
] as const;

const base = "inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] px-3 text-sm font-heading font-bold";

export function AdminTabs() {
  const { secret } = useAdminAuth();
  // Shared query keys => these reuse the cache the tabs populate; no extra fetch.
  const apps = useQuery({ queryKey: adminKeys.applications, queryFn: fetchApplications, enabled: !!secret, retry: false });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted"),
    queryFn: () => fetchSubmissions("submitted"),
    enabled: !!secret,
    retry: false,
  });
  const counts: Record<string, number | undefined> = {
    "/admin/applications": apps.data?.applications.length,
    "/admin/submissions": subs.data?.submissions.length,
  };
  return (
    <nav className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} className={`${base} bg-white`} activeProps={{ className: `${base} bg-[var(--color-acid)]` }}>
          {t.label}
          {counts[t.to] ? (
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-1.5 text-xs">{counts[t.to]}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
