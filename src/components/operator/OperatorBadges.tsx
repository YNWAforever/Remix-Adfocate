import type { AdminReviewStatus, AdminRiskLevel, AdminShortlistStatus } from "@/lib/admin";

const reviewTone: Record<AdminReviewStatus, string> = {
  approved: "bg-[var(--color-acid)]",
  needs_review: "bg-white",
  flagged: "bg-[var(--color-magenta)] text-white",
};

const riskTone: Record<AdminRiskLevel, string> = {
  low: "bg-[var(--color-acid)]",
  medium: "bg-[var(--color-sky)]",
  high: "bg-[var(--color-magenta)] text-white",
  unknown: "bg-white",
};

export function ReviewBadge({ status }: { status: AdminReviewStatus }) {
  return (
    <span className={`rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold ${reviewTone[status]}`}>
      {status}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: AdminRiskLevel }) {
  return (
    <span className={`rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold ${riskTone[risk]}`}>
      risk: {risk}
    </span>
  );
}

export function SocialSyncBadge({ label }: { label: "API-synced" | "Not synced" }) {
  return (
    <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
      {label}
    </span>
  );
}

export function ShortlistBadge({ status }: { status: AdminShortlistStatus }) {
  return (
    <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">
      {status}
    </span>
  );
}
