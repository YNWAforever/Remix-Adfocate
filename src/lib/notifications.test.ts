import { describe, it, expect } from "vitest";
import { renderNotification, type NotificationType } from "./notifications";
import { dict } from "./i18n.dict";

// Real interpolating t bound to a locale (mirrors i18n.tsx).
function makeT(locale: "en" | "zh") {
  return (key: string, params?: Record<string, string | number>) => {
    const s = dict[locale][key] ?? dict.en[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`)) : s;
  };
}
const t = makeT("zh");

function row(type: NotificationType, data: Record<string, unknown> = {}) {
  return { id: "n1", type, data, entity_id: null, entity_type: null, read_at: null, created_at: "2026-06-23T00:00:00Z" };
}

describe("renderNotification", () => {
  it.each([
    ["mission_product_shipped", { mission_title: "Launch", submission_id: "sub-1" }],
    ["mission_receipt_required", { mission_title: "Launch", submission_id: "sub-1" }],
    ["mission_revision_requested", { mission_title: "Launch", submission_id: "sub-1", deadline: "17 Jul" }],
    ["mission_draft_approved", { mission_title: "Launch", submission_id: "sub-1", deliverable_title: "Video", version_number: 2 }],
    ["mission_approved_to_publish", { mission_title: "Launch", submission_id: "sub-1" }],
    ["mission_deadline_approaching", { mission_title: "Launch", submission_id: "sub-1", deadline: "17 Jul" }],
    ["mission_deadline_overdue", { mission_title: "Launch", submission_id: "sub-1", deadline: "17 Jul" }],
  ] as const)("renders %s as an active-mission notification", (type, data) => {
    for (const locale of ["en", "zh"] as const) {
      const rendered = renderNotification(row(type, data), makeT(locale));

      expect(rendered.title).not.toBe("app.notif." + type + ".title");
      expect(rendered.body).toContain("Launch");
      expect(rendered.body).not.toMatch(/\{[a-z_]+\}/);
      expect(rendered.href).toBe("/my/sub-1");
      expect(rendered.icon).toBeTruthy();
    }
  });

  it("renders submission_approved with points/xp and links to the mission", () => {
    const r = renderNotification(row("submission_approved", { mission_title: "夏日開箱", mission_slug: "summer", points: 200, xp: 100 }), t);
    expect(r.title).toBe("內容已通過！");
    expect(r.body).toContain("夏日開箱");
    expect(r.body).toContain("200");
    expect(r.body).toContain("100");
    expect(r.href).toBe("/mission/summer");
  });

  it("renders level_up linking to passport", () => {
    const r = renderNotification(row("level_up", { level: "L2" }), t);
    expect(r.title).toBe("升級喇！");
    expect(r.body).toContain("L2");
    expect(r.href).toBe("/passport");
  });

  it("renders redemption_ready linking to redemption history", () => {
    const r = renderNotification(row("redemption_ready", { gift_name: "Starbucks 券" }), t);
    expect(r.body).toContain("Starbucks 券");
    expect(r.href).toBe("/redemption/history");
  });

  it("never leaks a raw {placeholder} when a data field is missing", () => {
    const r = renderNotification(row("submission_rejected", { mission_title: "X", mission_slug: "x" }), t);
    expect(r.body).not.toMatch(/\{[a-z_]+\}/);
  });

  it("renders campaign_goal_reached with points/xp and links to the campaign", () => {
    const v = renderNotification({ type: "campaign_goal_reached",
      data: { campaign_title: "六月挑戰", campaign_slug: "jun", points: 200, xp: 50 } } as never, t);
    expect(v.title).toBeTruthy();
    expect(v.body).toContain("六月挑戰");
    expect(v.href).toBe("/campaigns/jun");
  });

  it("renders campaign_prize_awarded with rank/cash", () => {
    const v = renderNotification({ type: "campaign_prize_awarded",
      data: { campaign_title: "六月挑戰", campaign_slug: "jun", rank: 1, cash: 500, points: 0, xp: 0 } } as never, t);
    expect(v.body).toContain("六月挑戰");
    expect(v.href).toBe("/campaigns/jun");
  });

  it("returns an icon name for every type", () => {
    (["submission_approved","submission_rejected","redemption_ready","level_up","application_accepted","application_declined",
      "campaign_goal_reached","campaign_prize_awarded","campaign_started"] as NotificationType[])
      .forEach((ty) => expect(renderNotification(row(ty), t).icon).toBeTruthy());
  });

  it("renders campaign_started with the campaign title and links to the campaign", () => {
    const r = renderNotification(row("campaign_started", { campaign_title: "夏日挑戰", campaign_slug: "summer" }), t);
    expect(r.title).toBeTruthy();
    expect(r.body).toContain("夏日挑戰");
    expect(r.href).toBe("/campaigns/summer");
  });
  it.each([
    {
      type: "mission_reward_pending",
      data: {
        mission_title: "Launch", submission_id: "sub-1", target_at: "17 Jul",
        reward_components: ["points", "cash"],
      },
      en: {
        title: "Reward handoff pending",
        body: "\"Launch\" is complete. Your reward is pending finance review. Target: 17 Jul.",
      },
      zh: {
        title: "獎勵交接待審核",
        body: "「Launch」已完成。獎勵交接正等待財務審核。目標日期：17 Jul。",
      },
    },
    {
      type: "mission_reward_pending_cancelled",
      data: {
        mission_title: "Launch", submission_id: "sub-1", reason_category: "contract_error",
      },
      en: {
        title: "Reward handoff cancelled",
        body: "\"Launch\" reward handoff was cancelled and returned for review. Category: contract_error.",
      },
      zh: {
        title: "獎勵交接已取消",
        body: "「Launch」的獎勵交接已取消並退回審核。類別：contract_error。",
      },
    },
  ] as const)("renders $type with exact bilingual pending-safe copy", ({ type, data, en, zh }) => {
    const renderedEn = renderNotification(row(type, data), makeT("en"));
    const renderedZh = renderNotification(row(type, data), makeT("zh"));
    expect(renderedEn).toMatchObject({ ...en, href: "/my/sub-1" });
    expect(renderedZh).toMatchObject({ ...zh, href: "/my/sub-1" });
    expect(`${renderedEn.title} ${renderedEn.body} ${renderedZh.title} ${renderedZh.body}`)
      .not.toMatch(/\b(?:paid|payout|credited|available|issued)\b/i);
  });

  it.each([
    ["missing", {}],
    ["null", { target_at: null }],
    ["empty", { target_at: "" }],
    ["malformed", { target_at: "not-a-date" }],
  ] as const)(
    "renders reward-pending %s target payload with explicit bilingual no-date copy",
    (_label, targetData) => {
      const data = {
        mission_title: "Launch",
        submission_id: "sub-1",
        ...targetData,
      };
      const renderedEn = renderNotification(
        row("mission_reward_pending", data),
        makeT("en"),
      );
      const renderedZh = renderNotification(
        row("mission_reward_pending", data),
        makeT("zh"),
      );

      expect(renderedEn).toMatchObject({
        body: "\"Launch\" is complete. Your reward is pending finance review. No target date has been set yet.",
        href: "/my/sub-1",
      });
      expect(renderedZh).toMatchObject({
        body: "「Launch」已完成。獎勵交接正等待財務審核，目前尚未有目標日期。",
        href: "/my/sub-1",
      });
      expect(`${renderedEn.body} ${renderedZh.body}`).not.toMatch(
        /Target:\s*\.|目標日期：。|\{target\}/,
      );
      expect(`${renderedEn.body} ${renderedZh.body}`).not.toMatch(
        /\b(?:paid|payout|credited|available|issued)\b/i,
      );
    },
  );
});
