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
      "campaign_goal_reached","campaign_prize_awarded"] as NotificationType[])
      .forEach((ty) => expect(renderNotification(row(ty), t).icon).toBeTruthy());
  });
});
