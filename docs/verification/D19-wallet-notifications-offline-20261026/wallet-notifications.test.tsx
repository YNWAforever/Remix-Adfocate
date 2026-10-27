// Standalone UI -> actual query/apiFetch -> Hono/routes -> scripted DB boundary.
// No SDK instance, physical Auth/RLS/DB, real notifications, redemption or provider.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Hono } from "hono";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const boundary = vi.hoisted(() => ({
  sdkCalls: 0, externalFetch: 0, token: "offline-session-a",
  userClient: (jwt: string): unknown => { void jwt; throw new Error("Scripted transport not installed"); },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => { boundary.sdkCalls++; throw new Error("Real SDK forbidden in offline verification"); } }));
vi.mock("@/lib/supabase", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: boundary.token } }, error: null }) }, channel: () => channel, removeChannel: () => undefined } };
});
vi.mock("../../../server/lib/supabase", () => ({ makeUserClient: (jwt: string) => boundary.userClient(jwt) }));

import type { Env } from "../../../server/app";
import { workspaceAuth } from "../../../server/middleware/workspace";
import { walletRoutes } from "../../../server/routes/wallet";
import { redemptionRoutes } from "../../../server/routes/redemption";
import { notificationRoutes } from "../../../server/routes/notifications";
import { Route as WalletRoute } from "../../../src/routes/_app.wallet";
import { Route as GiftsRoute } from "../../../src/routes/_app.redemption.index";
import { Route as NotificationsRoute } from "../../../src/routes/_app.notifications";
import { NotificationBadge } from "../../../src/components/NotificationBadge";
import { I18nProvider } from "../../../src/lib/i18n";
import { setWorkspaceSlug } from "../../../src/lib/api";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const W = "00000000-0000-4000-8000-000000000003", SUB = "00000000-0000-4000-8000-000000000004";
const N1 = "00000000-0000-4000-8000-000000000011", N2 = "00000000-0000-4000-8000-000000000012", NB = "00000000-0000-4000-8000-000000000013";
type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { code: string; message: string; details: null; hint: null } | null; count?: number };
type Filter = { key: string; op: "eq" | "in" | "is" | "lt"; value: unknown };
type QueryTrace = { table: string; op: string; columns: string; filters: Filter[]; rows: number; failed: boolean };
type RequestTrace = { path: string; method: string; status: number; workspace: string | null; bearerPresent: boolean; body: unknown; result: unknown };
let tables: Record<string, Row[]>;
let faultTables: Set<string>;
let queries: QueryTrace[];
let requests: RequestTrace[];
const observations: unknown[] = [];
let fixtureReadUpdates: Array<{ table: string; balance: number }>;
let app: Hono<Env>;
let qc: QueryClient | undefined;

function seed() {
  tables = {
    creators: [{ id: A, workspace_id: W, workspaces: { slug: "offline-facets" } }, { id: B, workspace_id: W, workspaces: { slug: "offline-facets" } }],
    point_balances: [{ creator_id: A, balance: 400, available_to: "2099-01-01T00:00:00Z" }, { creator_id: B, balance: 9000, available_to: null }],
    point_transactions: [{ id: "p1", creator_id: A, type: "earn", delta: 250, balance_after: 450, description: "Owned points witness", created_at: "2026-10-25T01:00:00Z" }, { id: "p2", creator_id: A, type: "redeem", delta: -50, balance_after: 400, description: "Owned debit witness", created_at: "2026-10-25T02:00:00Z" }, { id: "foreign-p", creator_id: B, type: "earn", delta: 9000, balance_after: 9000, description: "Foreign points must stay hidden", created_at: "2026-10-25T03:00:00Z" }],
    earnings_balances: [{ creator_id: A, available: "47.25" }, { creator_id: B, available: "9000" }],
    earnings_transactions: [{ id: "e1", creator_id: A, type: "earn", amount: "47.25", balance_after: "47.25", description: "Owned cash witness", created_at: "2026-10-25T01:00:00Z" }, { id: "foreign-e", creator_id: B, type: "earn", amount: "9000", balance_after: "9000", description: "Foreign cash must stay hidden", created_at: "2026-10-25T02:00:00Z" }],
    mission_submissions: [{ creator_id: A, status: "submitted", missions: { cash_reward: 10 } }, { creator_id: A, status: "under_review", missions: { cash_reward: "5" } }, { creator_id: A, status: "joined", missions: { cash_reward: 99 } }, { creator_id: B, status: "submitted", missions: { cash_reward: 900 } }],
    mission_reward_handoffs: [{ id: "scripted-pending-only", creator_id: A, status: "pending", cash: 9999 }],
    redemption_gifts: [{ id: "gift-a", workspace_id: W, name: "Offline gift", description: "No redemption permitted", category: "test", points_cost: 50, stock_remaining: 2, gift_type: "code", image_url: null, status: "active" }, { id: "foreign-gift", workspace_id: "other", name: "Foreign gift hidden", description: "", category: "test", points_cost: 0, stock_remaining: 1, gift_type: "code", image_url: null, status: "active" }],
    notifications: [
      { id: N1, user_id: A, type: "mission_revision_requested", data: { submission_id: SUB, mission_title: "Owned revision" }, entity_type: "mission_workflow", entity_id: SUB, read_at: null, created_at: "2026-10-25T02:00:00Z" },
      { id: N2, user_id: A, type: "mission_reward_pending", data: { submission_id: SUB, mission_title: "Owned reward" }, entity_type: "reward_handoff", entity_id: "pending-fixture", read_at: null, created_at: "2026-10-25T01:00:00Z" },
      { id: NB, user_id: B, type: "mission_reward_pending", data: { submission_id: "foreign-submission", mission_title: "Foreign notification hidden" }, entity_type: "reward_handoff", entity_id: "foreign-pending", read_at: null, created_at: "2026-10-25T03:00:00Z" },
    ],
  };
}
const field = (row: Row, key: string): unknown => key.split(".").reduce<unknown>((value, part) => (value as Row | null)?.[part], row);
class ScriptedQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private columns = "*";
  private head = false;
  private singleRow = false;
  private orderBy?: { key: string; ascending: boolean };
  private cap?: number;
  private patch?: Row;
  constructor(private jwt: string, private table: string) { if (!tables[table]) throw new Error(`Unscripted table: ${table}`); }
  select(columns: string, options?: { head?: boolean }) { this.columns = columns; this.head = !!options?.head; return this; }
  eq(key: string, value: unknown) { this.filters.push({ key, op: "eq", value }); return this; }
  in(key: string, value: unknown[]) { this.filters.push({ key, op: "in", value }); return this; }
  is(key: string, value: unknown) { this.filters.push({ key, op: "is", value }); return this; }
  lt(key: string, value: unknown) { this.filters.push({ key, op: "lt", value }); return this; }
  order(key: string, options: { ascending: boolean }) { this.orderBy = { key, ascending: options.ascending }; return this; }
  limit(cap: number) { this.cap = cap; return this; }
  maybeSingle() { this.singleRow = true; return Promise.resolve(this.run()); }
  single() { this.singleRow = true; return Promise.resolve(this.run()); }
  update(patch: Row) { if (this.table !== "notifications") throw new Error("Only scripted mark-read allowed"); this.patch = patch; return this; }
  private run(): Result {
    const owner = this.jwt === "offline-session-a" ? A : B;
    let result = tables[this.table].filter(row => this.table !== "creators" || row.id === owner); // Explicit fake creator-RLS boundary only.
    result = result.filter(row => this.filters.every(f => f.op === "in" ? (f.value as unknown[]).includes(field(row, f.key)) : f.op === "lt" ? String(field(row, f.key)) < String(f.value) : field(row, f.key) === f.value));
    if (this.orderBy) { const o = this.orderBy; result.sort((a,b) => String(field(a,o.key)).localeCompare(String(field(b,o.key))) * (o.ascending ? 1 : -1)); }
    if (this.cap !== undefined) result = result.slice(0, this.cap);
    const failed = faultTables.has(this.table);
    queries.push({ table: this.table, op: this.patch ? "update" : "select", columns: this.columns, filters: structuredClone(this.filters), rows: result.length, failed });
    if (failed) return { data: null, error: { code: "XX000", message: "Scripted offline failure", details: null, hint: null } };
    if (this.patch) result.forEach(row => Object.assign(row, this.patch));
    const projected = result.map(row => this.columns === "*" ? structuredClone(row) : Object.fromEntries(this.columns.split(",").map(raw => { const key = raw.trim().split("!")[0]; return [key, structuredClone(row[key])]; })));
    return { data: this.head ? null : this.singleRow ? projected[0] ?? null : projected, error: null, ...(this.head ? { count: result.length } : {}) };
  }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.run()).then(onfulfilled, onrejected); }
}
function mount(path: "/wallet" | "/redemption" | "/notifications") {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/wallet", component: WalletRoute.options.component }),
    createRoute({ getParentRoute: () => root, path: "/redemption", component: GiftsRoute.options.component }),
    createRoute({ getParentRoute: () => root, path: "/notifications", component: NotificationsRoute.options.component }),
  ]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<QueryClientProvider client={qc}><I18nProvider>{path === "/notifications" && <NotificationBadge />}<RouterProvider router={router} /></I18nProvider></QueryClientProvider>);
}
function finance() { return structuredClone(Object.fromEntries(["point_balances","point_transactions","earnings_balances","earnings_transactions","mission_reward_handoffs"].map(k => [k,tables[k]]))); }
let initialFinance: ReturnType<typeof finance>;
function balanceReadback(balance: number) {
  tables.point_balances[0].balance = balance;
  fixtureReadUpdates.push({ table: "point_balances", balance });
  initialFinance = finance(); // New scripted SELECT fixture; never a financial command.
}
async function direct(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers); const response = await app.request(path, init);
  requests.push({ path, method: init?.method ?? "GET", status: response.status, workspace: headers.get("X-Workspace-Slug"), bearerPresent: !!headers.get("Authorization"), body: init?.body ? JSON.parse(String(init.body)) : null, result: await response.clone().json() });
  return response;
}
beforeEach(() => {
  seed(); queries = []; requests = []; fixtureReadUpdates = []; faultTables = new Set(); boundary.sdkCalls = 0; boundary.externalFetch = 0; boundary.token = "offline-session-a";
  localStorage.setItem("lang", "en"); setWorkspaceSlug("offline-facets"); initialFinance = finance();
  boundary.userClient = jwt => ({ auth: { getUser: async () => jwt === "offline-session-a" || jwt === "offline-session-b" ? { data: { user: { id: jwt === "offline-session-a" ? A : B } }, error: null } : { data: { user: null }, error: { message: "Scripted invalid token" } } }, from: (table: string) => new ScriptedQuery(jwt, table), rpc: () => { throw new Error("RPC/redemption/provider forbidden in this verification"); } });
  app = new Hono<Env>().basePath("/api"); app.use("*", workspaceAuth); app.route("/wallet", walletRoutes); app.route("/redemption", redemptionRoutes); app.route("/notifications", notificationRoutes);
  app.get("/me", c => c.json({ id: c.get("userId"), display_name: "Offline Creator", avatar_url: null, level: "L1", level_seen: "L1", xp: 0, phone: null, categories: [], social_handles: [], social_accounts: [], onboarding_step: 4, onboarding_completed: true, referral_code: "OFFLINE", is_trusted: false, effective_level: "L1" })); // Scripted bootstrap response, not actual /me acceptance.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (!path.startsWith("/api/")) { boundary.externalFetch++; throw new Error("External fetch forbidden"); }
    return direct(path, init);
  });
});
afterEach(async () => {
  observations.push({ test: expect.getState().currentTestName, requests, queries, notifications: structuredClone(tables.notifications), scriptedFinancialRowsUnchangedSinceLatestFixtureReadback: JSON.stringify(finance()) === JSON.stringify(initialFinance), fixtureReadUpdates, sdkCalls: boundary.sdkCalls, deniedExternalFetchAttempts: boundary.externalFetch });
  cleanup(); await qc?.cancelQueries(); qc?.clear(); qc = undefined; vi.unstubAllGlobals();
  expect(boundary.sdkCalls).toBe(0); expect(boundary.externalFetch).toBe(0); expect(finance()).toEqual(initialFinance);
  expect(requests.filter(r => r.method !== "GET").every(r => r.path === "/api/notifications/read")).toBe(true);
});
afterAll(() => {
  const path = resolve(process.env.GATE14_READBACK ?? "");
  expect(path.startsWith(resolve("docs/verification/D19-wallet-notifications-offline-20261026") + "/") || path.startsWith(resolve("docs/verification/D19-wallet-notifications-offline-20261026") + "\\")).toBe(true);
  expect(existsSync(path)).toBe(false);
  writeFileSync(path, JSON.stringify({ scope: "Actual UI/query/apiFetch/Hono/workspace middleware with scripted Auth/DB/Realtime only; no physical persistence, Auth/RLS, real browser, payment/provider or D19 pending reward E2E neutrality", observations }, null, 2) + "\n");
});

describe("GATE14 independent offline wallet and notification acceptance facets", () => {
  it("UC-C13 shows owned points/history and available cash separately from pending estimates", async () => {
    mount("/wallet");
    expect(await screen.findByText("Owned points witness")).toBeVisible(); expect(await screen.findByText("Owned cash witness")).toBeVisible();
    expect(screen.getByText("400", { exact: true })).toBeVisible(); expect(screen.getByText("+250", { exact: true })).toBeVisible(); expect(screen.getByText("-50", { exact: true })).toBeVisible();
    expect(screen.getByText("HK$47.25", { exact: true })).toBeVisible(); expect(screen.getByText("HK$15.00", { exact: true })).toBeVisible();
    expect(screen.queryByText(/Foreign .*hidden/)).not.toBeInTheDocument(); expect(screen.queryByText("HK$9999.00")).not.toBeInTheDocument();
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it("UC-C13 exposes a failed points read and recovers on an explicit query refresh", async () => {
    faultTables.add("point_balances"); mount("/wallet"); expect(await screen.findByText("Failed to load points")).toBeVisible();
    expect(requests.some(r => r.path === "/api/wallet/points" && r.status === 500)).toBe(true);
    faultTables.clear(); await act(async () => { await qc!.invalidateQueries({ queryKey: ["balance"] }); });
    expect(await screen.findByText("400", { exact: true })).toBeVisible(); expect(screen.queryByText("Failed to load points")).not.toBeInTheDocument();
  });
  it("UC-C14 disables a one-point shortfall with an associated exact shortfall explanation", async () => {
    balanceReadback(49); mount("/redemption");
    const button = await screen.findByRole("button", { name: "Insufficient Points" }); expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription("Need 1 more pts");
    fireEvent.click(button); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText("Foreign gift hidden")).not.toBeInTheDocument();
  });
  it("UC-C14 disables out-of-stock stock even with enough points and cannot open a redemption", async () => {
    tables.redemption_gifts[0].stock_remaining = 0; mount("/redemption");
    const button = await screen.findByRole("button", { name: "Sold Out" }); expect(button).toBeDisabled(); fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it("UC-C14 re-evaluates availability from fresh balance/stock queries without redeeming", async () => {
    balanceReadback(49); mount("/redemption"); expect(await screen.findByRole("button", { name: "Insufficient Points" })).toBeDisabled();
    balanceReadback(50); await act(async () => { await qc!.invalidateQueries({ queryKey: ["balance"] }); });
    expect(await screen.findByRole("button", { name: "Redeem" })).toBeEnabled();
    tables.redemption_gifts[0].stock_remaining = 0; await act(async () => { await qc!.invalidateQueries({ queryKey: ["gifts"] }); });
    expect(await screen.findByRole("button", { name: "Sold Out" })).toBeDisabled();
  });
  it("UC-C36 renders exact saved-submission links and reconciles the badge to the actual owned read update", async () => {
    mount("/notifications"); await waitFor(() => expect(requests.some(r => r.path === "/api/notifications/read" && r.status === 200)).toBe(true));
    await waitFor(() => expect(requests.some(r => r.path === "/api/notifications/unread-count" && (r.result as { count: number }).count === 0)).toBe(true));
    const links = screen.getAllByRole("link"); expect(links).toHaveLength(2); for (const link of links) expect(link).toHaveAttribute("href", `/my/${SUB}`);
    expect(screen.queryByLabelText(/unread$/)).not.toBeInTheDocument(); expect(screen.queryByText(/Foreign notification hidden/)).not.toBeInTheDocument();
    expect(tables.notifications.find(r => r.id === NB)!.read_at).toBeNull(); expect(tables.notifications.filter(r => r.user_id === A).every(r => typeof r.read_at === "string")).toBe(true);
    const post = requests.find(r => r.path === "/api/notifications/read")!; expect(post.body).toEqual({ ids: [N1, N2] }); expect(post.result).toEqual({ updated: 2 });
  });
  it("UC-C36 repeated owned/foreign/duplicate mark-read IDs cannot alter the other recipient", async () => {
    const headers = { Authorization: "Bearer offline-session-a", "X-Workspace-Slug": "offline-facets", "Content-Type": "application/json" };
    const body = JSON.stringify({ ids: [N1, N1, NB] }); const first = await direct("/api/notifications/read", { method: "POST", headers, body }); expect(await first.json()).toEqual({ updated: 1 });
    const saved = structuredClone(tables.notifications); const again = await direct("/api/notifications/read", { method: "POST", headers, body }); expect(await again.json()).toEqual({ updated: 0 });
    expect(tables.notifications).toEqual(saved); expect(tables.notifications.find(r => r.id === NB)!.read_at).toBeNull();
  });
  it("UC-C13 actual workspace middleware rejects missing token and wrong workspace before wallet reads", async () => {
    expect((await direct("/api/wallet/points")).status).toBe(401);
    expect((await direct("/api/wallet/points", { headers: { Authorization: "Bearer offline-session-a", "X-Workspace-Slug": "wrong-workspace" } })).status).toBe(403);
    expect(queries.some(q => q.table === "point_balances")).toBe(false);
  });
});
