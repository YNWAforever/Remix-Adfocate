// server/lib/radar.test.ts
import { describe, it, expect } from "vitest";
import {
  shapeRadar,
  type ShapeRadarInput,
  type AtRiskRawRow,
  type OverdueRawRow,
  type RecentApprovalRawRow,
  type NewCreatorRawRow,
} from "./radar";

const NOW = "2026-06-30T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86_400_000;
// Helper: ISO string N days before NOW
const daysAgo = (n: number) => new Date(NOW_MS - n * DAY_MS).toISOString();
// Helper: ISO string N days after NOW (future deadline)
const daysAhead = (n: number) => new Date(NOW_MS + n * DAY_MS).toISOString();

let uid = 0;
function sub(over: Partial<AtRiskRawRow> & { creator_id: string; status: string }): AtRiskRawRow {
  return {
    creator_id: over.creator_id,
    status: over.status,
    created_at: over.created_at ?? daysAgo(60),
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
    creators: over.creators ?? { display_name: `User ${over.creator_id}`, phone: null },
  };
}

function overdue(over: Partial<OverdueRawRow> & { id: string }): OverdueRawRow {
  return {
    id: over.id,
    creator_id: over.creator_id ?? `c${uid++}`,
    status: over.status ?? "submitted",
    review_deadline: over.review_deadline ?? daysAgo(1),
    creators: over.creators ?? { display_name: "Creator" },
    missions: over.missions ?? { title: "Test Mission" },
  };
}

function approval(over: Partial<RecentApprovalRawRow> & { creator_id: string }): RecentApprovalRawRow {
  return {
    creator_id: over.creator_id,
    quality_rating: over.quality_rating ?? null,
    creators: over.creators ?? { display_name: "Creator", level: "L1" },
  };
}

function newCreator(over: Partial<NewCreatorRawRow> & { id: string }): NewCreatorRawRow {
  return {
    id: over.id,
    display_name: over.display_name ?? `New ${over.id}`,
    phone: over.phone ?? null,
    created_at: over.created_at ?? daysAgo(5),
  };
}

function base(over: Partial<ShapeRadarInput> = {}): ShapeRadarInput {
  return {
    now: NOW,
    days: 30,
    allSubmissions: over.allSubmissions ?? [],
    overdueSubmissions: over.overdueSubmissions ?? [],
    recentApprovals: over.recentApprovals ?? [],
    newCreators: over.newCreators ?? [],
    allParticipantIds: over.allParticipantIds ?? [],
  };
}

describe("shapeRadar", () => {
  it("returns empty queues on empty input without throwing", () => {
    const r = shapeRadar(base());
    expect(r.atRisk.total).toBe(0);
    expect(r.atRisk.items).toHaveLength(0);
    expect(r.slaBreaching.total).toBe(0);
    expect(r.rising.total).toBe(0);
    expect(r.newUnactivated.total).toBe(0);
    expect(r.window.days).toBe(30);
  });

  it("caps each queue at 20, reporting the full total", () => {
    const subs = Array.from({ length: 25 }, (_, i) => sub({ creator_id: `c${i}`, status: "approved", created_at: daysAgo(60) }));
    const r = shapeRadar(base({ allSubmissions: subs }));
    expect(r.atRisk.total).toBe(25);
    expect(r.atRisk.items).toHaveLength(20);
  });

  it("excludes at-risk creators who have an active row", () => {
    const stale = sub({ creator_id: "stale", status: "approved", created_at: daysAgo(60) });
    const active = sub({ creator_id: "active", status: "joined", created_at: daysAgo(60) });
    const r = shapeRadar(base({ allSubmissions: [stale, active] }));
    expect(r.atRisk.total).toBe(1);
    expect(r.atRisk.items[0].creator_id).toBe("stale");
  });

  it("computes days_idle correctly from the most recent activity timestamp", () => {
    // Creator has two rows; last activity = submitted_at = 40 days ago
    const rows = [
      sub({ creator_id: "x", status: "rejected", created_at: daysAgo(60), submitted_at: daysAgo(40) }),
      sub({ creator_id: "x", status: "approved", created_at: daysAgo(50), submitted_at: daysAgo(45), reviewed_at: daysAgo(40) }),
    ];
    const r = shapeRadar(base({ allSubmissions: rows }));
    expect(r.atRisk.total).toBe(1);
    expect(r.atRisk.items[0].days_idle).toBe(40);
  });

  it("classifies SLA rows as overdue (past deadline) or due_soon (future ≤ 2d)", () => {
    const rows = [
      overdue({ id: "o1", review_deadline: daysAgo(1) }),   // overdue
      overdue({ id: "o2", review_deadline: daysAhead(1) }), // due_soon
    ];
    const r = shapeRadar(base({ overdueSubmissions: rows }));
    expect(r.slaBreaching.total).toBe(2);
    const o = r.slaBreaching.items.find(i => i.submission_id === "o1")!;
    const d = r.slaBreaching.items.find(i => i.submission_id === "o2")!;
    expect(o.urgency).toBe("overdue");
    expect(d.urgency).toBe("due_soon");
    expect(o.hours_overdue).toBeGreaterThan(0);
    expect(d.hours_overdue).toBeLessThan(0);
  });

  it("computes rising score = approvals × avg_quality, defaulting null quality to 3", () => {
    const rows = [
      approval({ creator_id: "r1", quality_rating: 5 }),
      approval({ creator_id: "r1", quality_rating: 3 }),
      approval({ creator_id: "r2", quality_rating: null }), // defaults to 3
      approval({ creator_id: "r2", quality_rating: null }),
    ];
    const r = shapeRadar(base({ recentApprovals: rows }));
    const r1 = r.rising.items.find(i => i.creator_id === "r1")!;
    const r2 = r.rising.items.find(i => i.creator_id === "r2")!;
    expect(r1.recent_approvals).toBe(2);
    expect(r1.avg_quality).toBe(4); // (5+3)/2
    expect(r1.score).toBe(8);       // 2 × 4
    expect(r2.avg_quality).toBeNull();
    expect(r2.score).toBe(6);       // 2 × 3 (default)
  });

  it("excludes new creators who already have a participation record", () => {
    const creators = [
      newCreator({ id: "new1" }),
      newCreator({ id: "new2" }), // has a participation
    ];
    const r = shapeRadar(base({
      newCreators: creators,
      allParticipantIds: ["new2"],
    }));
    expect(r.newUnactivated.total).toBe(1);
    expect(r.newUnactivated.items[0].creator_id).toBe("new1");
  });

  it("computes days_since_join for new/unactivated creators", () => {
    const creators = [newCreator({ id: "n1", created_at: daysAgo(10) })];
    const r = shapeRadar(base({ newCreators: creators }));
    expect(r.newUnactivated.items[0].days_since_join).toBe(10);
  });
});
