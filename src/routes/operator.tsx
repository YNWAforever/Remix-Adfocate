import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ListFilter } from "lucide-react";
import { adminFetch, getAdminSecret } from "@/lib/admin";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import { ReviewBadge, ShortlistBadge } from "@/components/operator/OperatorBadges";

export const Route = createFileRoute("/operator")({ component: OperatorApplications });

type Application = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  creator_review?: { status: "needs_review" | "approved" | "flagged"; risk_level: "low" | "medium" | "high" | "unknown" } | null;
  mission_shortlist?: { status: string } | null;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

function OperatorApplications() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const qc = useQueryClient();

  const apps = useQuery({
    queryKey: ["admin-applications"],
    enabled: !!secret,
    retry: false,
    queryFn: () => adminFetch<{ applications: Application[] }>("/admin/applications"),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      adminFetch(`/admin/applications/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-applications"] }),
  });

  return (
    <OperatorAuthGate error={apps.error} prompt="輸入管理密碼以檢視申請" onSecretChange={setSecret}>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div>
            <h1 className="font-display text-xl font-bold">待審批申請</h1>
            <p className="text-sm text-[var(--color-soft-ink)]">處理 mission 申請並切換到創作者審核佇列。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/operator/creators"
              className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold"
            >
              <ListFilter className="h-4 w-4" />
              創作者審核
            </Link>
          </div>
        </div>
        {apps.isLoading && <p className="text-sm">載入中…</p>}
        {apps.data?.applications.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批申請</p>}
        <div className="space-y-3">
          {apps.data?.applications.map((a) => (
            <div
              key={a.id}
              className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading font-bold">{a.creators.display_name}</p>
                  {a.creator_review?.status ? <ReviewBadge status={a.creator_review.status} /> : null}
                  {a.mission_shortlist?.status ? (
                    <ShortlistBadge status={a.mission_shortlist.status as "shortlisted" | "invited" | "dismissed" | "accepted" | "declined"} />
                  ) : (
                    <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                      not shortlisted
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
                {a.mission_id ? (
                  <a href={`/operator/missions/${a.mission_id}`} className="text-xs font-bold underline">
                    Mission selection
                  </a>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button aria-label="接受" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">接受</button>
                <button aria-label="拒絕" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </OperatorAuthGate>
  );
}
