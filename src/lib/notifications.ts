import { CheckCircle2, XCircle, Gift, TrendingUp, UserCheck, UserX, Trophy, Award, Bell, Megaphone, type LucideIcon } from "lucide-react";

export type NotificationType =
  | "submission_approved" | "submission_rejected" | "redemption_ready"
  | "level_up" | "application_accepted" | "application_declined"
  | "campaign_goal_reached" | "campaign_prize_awarded" | "campaign_started"
  | "mission_product_shipped" | "mission_receipt_required"
  | "mission_revision_requested" | "mission_draft_approved" | "mission_approved_to_publish"
  | "mission_deadline_approaching" | "mission_deadline_overdue"
  | "mission_publication_correction_requested" | "mission_publication_verified"
  | "mission_reward_pending" | "mission_reward_pending_cancelled";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type RenderedNotification = { title: string; body: string; href: string; icon: LucideIcon };

type T = (key: string, params?: Record<string, string | number>) => string;

const ICONS: Record<NotificationType, LucideIcon> = {
  submission_approved: CheckCircle2,
  submission_rejected: XCircle,
  redemption_ready: Gift,
  level_up: TrendingUp,
  application_accepted: UserCheck,
  application_declined: UserX,
  campaign_goal_reached: Trophy,
  campaign_prize_awarded: Award,
  campaign_started: Megaphone,
  mission_product_shipped: Gift,
  mission_receipt_required: Bell,
  mission_revision_requested: XCircle,
  mission_draft_approved: CheckCircle2,
  mission_approved_to_publish: Trophy,
  mission_deadline_approaching: TrendingUp,
  mission_deadline_overdue: Bell,
  mission_publication_correction_requested: XCircle,
  mission_publication_verified: CheckCircle2,
  mission_reward_pending: Bell,
  mission_reward_pending_cancelled: XCircle,
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICONS[type] ?? Bell;
}

/** Build the full {param} set each template might reference, coalescing missing
 *  fields to "" so t() never leaves a raw {placeholder} (see i18n interpolate). */
function paramsFor(data: Record<string, unknown>): Record<string, string | number> {
  const s = (k: string) => (data[k] == null ? "" : String(data[k]));
  const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : 0);
  const list = (k: string) => Array.isArray(data[k])
    ? (data[k] as unknown[]).map(String).join(",") : s(k);
  return {
    mission: s("mission_title"),
    level: s("level"),
    gift: s("gift_name"),
    reason: s("reason"),
    notes: s("notes"),
    points: n("points"),
    xp: n("xp"),
    campaign: s("campaign_title"),
    rank: n("rank"),
    cash: n("cash"),
    deliverable: s("deliverable_title"),
    deadline: s("deadline"),
    target: s("target_at"),
    version: n("version_number"),
    reasonCategory: s("reason_category"),
    attempt: n("attempt_number"),
    reasonCategories: list("reason_categories"),
  };
}

function hrefFor(row: NotificationRow): string {
  switch (row.type) {
    case "level_up": return "/passport";
    case "redemption_ready": return "/redemption/history";
    case "campaign_goal_reached":
    case "campaign_prize_awarded":
    case "campaign_started": {
      const slug = row.data.campaign_slug;
      return typeof slug === "string" && slug ? `/campaigns/${slug}` : "/campaigns";
    }
    case "mission_product_shipped":
    case "mission_receipt_required":
    case "mission_revision_requested":
    case "mission_draft_approved":
    case "mission_approved_to_publish":
    case "mission_deadline_approaching":
    case "mission_deadline_overdue":
    case "mission_publication_correction_requested":
    case "mission_publication_verified":
    case "mission_reward_pending":
    case "mission_reward_pending_cancelled": {
      const submissionId = row.data.submission_id;
      return typeof submissionId === "string" && submissionId
        ? `/my/${submissionId}`
        : "/home";
    }
    default: {
      const slug = row.data.mission_slug;
      return typeof slug === "string" && slug ? `/mission/${slug}` : "/home";
    }
  }
}

function hasValidRewardTarget(data: Record<string, unknown>): boolean {
  const target = data.target_at;
  return typeof target === "string"
    && target.trim().length > 0
    && !Number.isNaN(Date.parse(target));
}

export function renderNotification(row: NotificationRow, t: T): RenderedNotification {
  const params = paramsFor(row.data);
  const bodyKey = row.type === "mission_reward_pending"
    && !hasValidRewardTarget(row.data)
    ? "app.notif.mission_reward_pending.bodyNoTarget"
    : `app.notif.${row.type}.body`;
  return {
    title: t(`app.notif.${row.type}.title`),
    body: t(bodyKey, params),
    href: hrefFor(row),
    icon: iconFor(row.type),
  };
}
