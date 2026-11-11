// @vitest-environment node
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "../lib/staffAuth";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { adminAssistantRoutes } from "../routes/adminAssistant";

type Row = Record<string, unknown>;

function db(rows: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Row = {};
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      then(resolve: (value: unknown) => unknown) {
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
          if (Array.isArray(value)) return value.includes(row[key]);
          return row[key] === value;
        }));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { from } as unknown as Parameters<typeof adminAssistantRoutes.request>[0];
}

function app() {
  return new Hono<AdminEnv>()
    .use("*", async (c, next) => {
      c.set("staff", { userId: "staff-owner", email: "owner@example.test", active: true });
      c.set("authorizedWorkspace", { workspaceId: "w1", workspaceSlug: "owned", userId: "staff-owner" });
      await next();
    })
    .route("/", adminAssistantRoutes);
}

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

beforeEach(() => {
  h.db = db({
    assistant_requests: [
      { workspace_id: "w1", state: "saved", created_at: iso(-60 * 60 * 1000) },
      { workspace_id: "w1", state: "unknown", created_at: iso(-2 * 60 * 60 * 1000) },
      { workspace_id: "w1", state: "failed", created_at: iso(-3 * 60 * 60 * 1000) },
      { workspace_id: "w1", state: "saved", created_at: iso(-3 * 24 * 60 * 60 * 1000) },
      { workspace_id: "w1", state: "saved", created_at: iso(-10 * 24 * 60 * 60 * 1000) },
      { workspace_id: "w2", state: "unknown", created_at: iso(-60 * 60 * 1000) },
    ],
    assistant_proposal_audit: [
      { workspace_id: "w1", outcome: "executed", created_at: iso(-60 * 60 * 1000) },
      { workspace_id: "w1", outcome: "failed", created_at: iso(-2 * 60 * 60 * 1000) },
      { workspace_id: "w1", outcome: "executed", created_at: iso(-3 * 24 * 60 * 60 * 1000) },
    ],
  });
});

describe("admin assistant reliability", () => {
  it("buckets workspace-scoped request and proposal outcomes by window", async () => {
    const response = await app().request("/reliability");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      requests: Record<string, { total: number; saved: number; unknown: number; failed: number; pending: number }>;
      proposals: Record<string, { total: number; executed: number; failed: number }>;
      last_unknown_at: string | null;
    };
    expect(body.requests["24h"]).toEqual({ total: 3, saved: 1, unknown: 1, failed: 1, pending: 0 });
    expect(body.requests["7d"]).toEqual({ total: 4, saved: 2, unknown: 1, failed: 1, pending: 0 });
    expect(body.proposals["24h"]).toEqual({ total: 2, executed: 1, failed: 1 });
    expect(body.proposals["7d"]).toEqual({ total: 3, executed: 2, failed: 1 });
    expect(body.last_unknown_at).toBeTruthy();
  });
});
