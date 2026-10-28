// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminEnv } from "../lib/staffAuth";

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, Row[]> }));
// Substitute only the database transport; the route and metric calculations run unchanged.
vi.mock("../lib/supabase", () => ({ serviceClient: () => ({ from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let first = 0, last = 999;
  const query = {
    select: () => query,
    eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
    gte(key: string, value: string) { filters.push(row => typeof row[key] === "string" && Date.parse(row[key] as string) >= Date.parse(value)); return query; },
    lt(key: string, value: string) { filters.push(row => typeof row[key] === "string" && Date.parse(row[key] as string) < Date.parse(value)); return query; },
    order: () => query,
    or: () => query,
    range(from: number, to: number) { first = from; last = to; return query; },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: (fixture.rows[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(first, last + 1), error: null }).then(resolve);
    },
  };
  return query;
} }) }));
import { adminInsightsRoutes } from "../routes/adminInsights";

const app = new Hono<AdminEnv>().use("*", async (c, next) => {
  c.set("authorizedWorkspace", { userId: "operator", workspaceId: "owned", workspaceSlug: "owned" });
  await next();
}).route("/admin", adminInsightsRoutes);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  fixture.rows = {
    mission_work_items: ["before", "later"].map(id => ({ id, workspace_id: "owned", state: "approved_to_publish", required: true,
      deadline: null, created_at: "2026-10-21T00:00:00Z", workflow: { created_at: "2026-10-21T00:00:00Z" } })),
    mission_draft_versions: ["before", "later"].map(id => ({ id: `${id}-v1`, workspace_id: "owned", mission_work_item_id: id,
      submitted_at: "2026-10-21T01:00:00Z", version_number: 1 })),
    mission_review_rounds: [{ id: "before-round", workspace_id: "owned", mission_work_item_id: "before", state: "approved_to_publish",
      created_at: "2026-10-21T02:00:00Z", review_started_at: "2026-10-21T12:00:00Z", decision_at: "2026-10-21T12:05:00Z", round_number: 1 }],
  };
});
afterEach(() => vi.useRealTimers());

it.each([
  ["approved_to_publish", "2026-10-22T16:00:00Z"],
  ["revision_requested", "2026-10-22T16:00:00Z"],
  ["approved_to_publish", "2026-10-23T01:00:00Z"],
  ["revision_requested", "2026-10-23T01:00:00Z"],
  ["open", null],
])("excludes %s decided at %s from the completed Hong Kong reporting window", async (state, decisionAt) => {
  fixture.rows.mission_review_rounds.push({ id: "later-round", workspace_id: "owned", mission_work_item_id: "later", state,
    created_at: "2026-10-21T02:00:00Z", review_started_at: "2026-10-21T12:00:00Z", decision_at: decisionAt, round_number: 1 });
  const response = await app.request("/admin/insights?window=7");
  expect(response.status).toBe(200);
  const { insights } = await response.json();
  expect(insights.window.to).toBe("2026-10-22T16:00:00.000Z");
  expect(insights.outcomes.firstReviewAcceptance).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  expect(insights.outcomes.revisionRounds).toEqual({ samples: 2, total: 0, mean: 0 });
  expect(insights.outcomes.operatorHandlingMs).toEqual({ samples: 1, median: 300000 });
});

it("retains decisions before the cutoff in their joined cohort", async () => {
  fixture.rows.mission_review_rounds.push({ id: "revision-round", workspace_id: "owned", mission_work_item_id: "later", state: "revision_requested",
    created_at: "2026-10-21T02:00:00Z", review_started_at: "2026-10-22T15:55:00Z", decision_at: "2026-10-22T15:59:59Z", round_number: 1 });
  const response = await app.request("/admin/insights?window=7");
  expect(response.status).toBe(200);
  const { insights } = await response.json();
  expect(insights.outcomes.firstReviewAcceptance).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  expect(insights.outcomes.revisionRounds).toEqual({ samples: 2, total: 1, mean: 0.5 });
  expect(insights.outcomes.operatorHandlingMs).toEqual({ samples: 2, median: 299500 });
});
