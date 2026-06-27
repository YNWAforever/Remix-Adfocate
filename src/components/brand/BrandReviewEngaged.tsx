import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandEngaged } from "@/lib/brand";
import type { EngagedCreator } from "@/lib/admin";

const STAGE_ZH: Record<string, string> = { joined: "已加入", submitted: "已提交", under_review: "審核中" };

export function BrandReviewEngaged() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.engaged(), queryFn: fetchBrandEngaged, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (q.data?.creators.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.engagedEmpty")}</p>;

  return (
    <div className="space-y-3">
      {q.data?.creators.map((c) => <BrandEngagedCard key={c.id} creator={c} />)}
    </div>
  );
}

function BrandEngagedCard({ creator }: { creator: EngagedCreator }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold">{creator.displayName ?? "未命名"}</span>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{creator.level}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span>{creator.activeCount} 進行中</span>
          <span>{creator.completedCount} 已完成</span>
          <span>{creator.pointsEarned} 分</span>
        </div>
      </button>
      {open && (
        <ul className="space-y-2 border-t-2 border-[var(--color-ink)] p-3">
          {creator.activeMissions.map((m) => (
            <li key={m.submissionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{m.missionTitle}</span>
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{STAGE_ZH[m.status] ?? m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
