import { expect, test, type Browser } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
const fx = process.env.ADFOCATE_BROWSER_SCOPE === "R2_UI" ? JSON.parse(readFileSync(".codex-tmp/R2-ui-fixture.private.json", "utf8")) : {};
test.beforeEach(() => test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "R2_UI", "Use the identity-gated R2 runner."));
const record = (name: string, value: unknown) => writeFileSync(`docs/verification/R2-ui-${name}.json`, JSON.stringify({ runId: fx.runId, value }, null, 2) + "\n");
async function context(browser: Browser, staff = false) {
  const actor = staff ? fx.operator : fx.creator;
  const ctx = await browser.newContext({ viewport: staff ? { width: 1280, height: 900 } : { width: 390, height: 844 } });
  await ctx.addInitScript(session => { localStorage.setItem("lang", "en"); localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, actor.session);
  await ctx.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["56400","56421"].includes(url.port) ? route.continue() : route.abort(); });
  return ctx;
}
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`http://127.0.0.1:56400/api${path}`, { method, headers: { Authorization: `Bearer ${fx.operator.jwt}`, "X-Workspace-Slug": fx.slug, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect(response.status).toBe(200); return response.json();
}
test("UC-C15 real empty redemption history, return entrance and recovery", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto("/redemption/history"); await expect(page.getByText("No redemptions yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Redeem" })).toHaveAttribute("href", "/redemption");
  await page.route("**/api/redemption/history", r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }));
  await page.reload(); await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("No redemptions yet", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/redemption/history"); await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByText("No redemptions yet", { exact: true })).toBeVisible();
  record("UC-C15", { actualEmptyRows: fx.emptyReadCounts.history, returnPath: "/redemption", fault: "explicit 503 transport mock", recovery: "real Auth/API/DB read" });
  await ctx.close();
});
test("UC-C16 real no-active-challenge state and failed-read retry", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto("/campaigns"); await expect(page.getByText("No challenges right now — check back soon.", { exact: true })).toBeVisible();
  await page.route("**/api/campaigns", r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }));
  await page.reload(); await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("No challenges right now — check back soon.", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/campaigns"); await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByText("No challenges right now — check back soon.", { exact: true })).toBeVisible();
  record("UC-C16", { actualEmptyRows: fx.emptyReadCounts.campaigns, fault: "explicit 503 transport mock", recovery: "real read" }); await ctx.close();
});
test("UC-C17 real Academy readable/preparing and locked eligibility; empty and fault UI", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage(); await page.goto("/guide");
  await expect(page.getByRole("link", { name: /Synthetic R2 parent 1/ })).toHaveAttribute("href", `/guide/track/${fx.tracks[1].slug}`);
  await expect(page.getByText("Synthetic R2 parent 2", { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/guide/track/${fx.tracks[2].slug}"]`)).toHaveCount(0);
  await page.screenshot({ path: "docs/verification/R2-ui-academy.png" });
  await page.route("**/api/academy?*", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"docs":[],"tracks":[],"playbooks":[],"resources":[]}' }));
  await page.reload(); await expect(page.getByText(/No courses available/)).toBeVisible();
  await page.unroute("**/api/academy?*");
  await page.route("**/api/academy?*", r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }));
  await page.reload(); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByText(/No courses available/)).toHaveCount(0);
  await page.unroute("**/api/academy?*"); await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByText("Synthetic R2 parent 2", { exact: true })).toBeVisible();
  record("UC-C17", { actualPublishedParentIds: fx.tracks.slice(1).map((t: { id: string }) => t.id), qualification: "real API/me data and existing eligibility gate", emptyBundle: "explicit transport mock; global retained Academy rows were not deleted", fault: "explicit 503", lessonsCreated: 0, curriculumApproval: false }); await ctx.close();
});
test("UC-A45 real empty applications, recoverable failure and reload", async ({ browser }) => {
  const ctx = await context(browser, true), page = await ctx.newPage(); await page.goto("/admin/applications");
  await expect(page.getByText("No pending applications", { exact: true })).toBeVisible();
  await page.route("**/api/admin/applications*", r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }));
  await page.reload(); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByText("No pending applications", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/admin/applications*"); await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByText("No pending applications", { exact: true })).toBeVisible();
  record("UC-A45", { actualEmptyRows: fx.emptyReadCounts.applications, fault: "explicit 503", recovery: "real scoped read", noApplicationDecision: true }); await ctx.close();
});
test("UC-A49 challenge/content empty entrances, preserved filter and retry", async ({ browser }) => {
  const ctx = await context(browser, true), page = await ctx.newPage(); await page.goto("/admin/campaigns");
  await expect(page.getByText("此品牌尚未有挑戰。", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /新挑戰/ })).toHaveAttribute("href", "/admin/campaigns/new");
  let emptyMock = false;
  if (fx.emptyReadCounts.content !== 0) { emptyMock = true; await page.route("**/api/admin/content?*", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"items":[],"total":0,"page":1,"pageSize":20}' })); }
  await page.goto("/admin/content"); await expect(page.getByText("No content yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New content", exact: true })).toHaveAttribute("href", "/admin/content/new");
  await page.unroute("**/api/admin/content?*");
  await page.route("**/api/admin/content?*", r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }));
  await page.getByRole("combobox", { name: /Content status/ }).selectOption("draft"); await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Content status/ })).toHaveValue("draft");
  await page.getByRole("button", { name: /Retry/ }).focus();
  await page.unroute("**/api/admin/content?*"); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0); await expect(page.getByRole("combobox", { name: /Content status/ })).toHaveValue("draft");
  record("UC-A49", { actualChallengeRows: fx.emptyReadCounts.adminCampaigns, actualGlobalContentRows: fx.emptyReadCounts.content, contentEmptyTransportMock: emptyMock, selectedStatusRetained: "draft", recovery: "real API read", noPublishOrSettlement: true }); await ctx.close();
});
test("F27 parent metadata saves with explicit retry and survives hard reload", async ({ browser }) => {
  const ctx = await context(browser, true), page = await ctx.newPage(), parent = fx.tracks[0];
  await page.goto(`/admin/academy/${parent.id}`);
  const zh = page.getByRole("textbox", { name: "Learning time (中文)", exact: true });
  const { item: original } = await api(`/admin/academy/${parent.id}`);
  await expect(zh).toHaveValue(original.metadata.duration.zh); await expect(page.getByRole("textbox", { name: /Metadata/ })).toHaveCount(0);
  await zh.fill("15 分鐘"); await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("textbox", { name: "Learning time (EN)", exact: true }).fill("15 minutes");
  const pattern = `**/api/admin/academy/${parent.id}`;
  await page.route(pattern, r => r.request().method() === "PATCH" ? r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit synthetic fault"}' }) : r.continue());
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Learning time (EN)", exact: true })).toHaveValue("15 minutes");
  await page.unroute(pattern); const saved = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(parent.id) && r.request().method() === "PATCH" && r.status() === 200);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await saved; await page.reload();
  await expect(zh).toHaveValue("15 分鐘"); await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Learning time (EN)", exact: true })).toHaveValue("15 minutes");
  const { item } = await api(`/admin/academy/${parent.id}`);
  expect(item.metadata.futureExtension).toEqual(parent.metadata.futureExtension); expect(item.metadata.learningEnabled).toBe(false);
  expect(item.metadata.duration).toEqual({ zh: "15 分鐘", en: "15 minutes" });
  record("F27-roundtrip", { parentId: parent.id, metadata: item.metadata, fault: "explicit PATCH503 mock", successfulSaveAndReload: "real API/Auth/RLS/DB", noLessonOrRewardWrite: true });
  await page.screenshot({ path: "docs/verification/R2-ui-parent-form.png" }); await ctx.close();
});
test("F27 real 409 compares latest and preserves both authored and concurrent metadata", async ({ browser }) => {
  const ctx = await context(browser, true), page = await ctx.newPage(), parent = fx.tracks[0];
  await page.goto(`/admin/academy/${parent.id}`); const field = page.getByRole("textbox", { name: "Learning time (中文)", exact: true });
  await expect(field).toHaveValue("15 分鐘"); await field.fill("保留的中文時間");
  const { item: before } = await api(`/admin/academy/${parent.id}`);
  const { item: concurrent } = await api(`/admin/academy/${parent.id}`, "PATCH", { updated_at: before.updated_at,
    metadata: { ...before.metadata, duration: { ...before.metadata.duration, en: "Concurrent 20 minutes" }, concurrentUnknown: { retain: true } } });
  const conflict = page.waitForResponse(r => r.request().method() === "PATCH" && r.status() === 409);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await conflict;
  await expect(field).toHaveValue("保留的中文時間"); await page.getByRole("button", { name: "Compare latest", exact: true }).click();
  await page.getByRole("button", { name: "Keep my edits on this revision", exact: true }).click();
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.status() === 200);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await saved;
  const { item: after } = await api(`/admin/academy/${parent.id}`);
  expect(after.metadata).toEqual({ ...concurrent.metadata, duration: { zh: "保留的中文時間", en: "Concurrent 20 minutes" } });
  await page.reload(); await expect(field).toHaveValue("保留的中文時間");
  record("F27-conflict", { parentId: parent.id, real409: true, explicitAcknowledgement: true, metadata: after.metadata, reloadEqual: true }); await ctx.close();
});
test("F27 legacy plain-string metadata preserves a concurrent language through real409", async ({ browser }) => {
  const parent = fx.tracks[0], path = `/admin/academy/${parent.id}`;
  const { item: before } = await api(path);
  await api(path, "PATCH", { updated_at: before.updated_at, metadata: { ...before.metadata, duration: "Legacy timing" } });
  const ctx = await context(browser, true), page = await ctx.newPage(); await page.goto(`/admin/academy/${parent.id}`);
  const field = page.getByRole("textbox", { name: "Learning time (中文)", exact: true });
  await expect(field).toHaveValue("Legacy timing"); await field.fill("Legacy authored ZH");
  const { item: baseline } = await api(path);
  const { item: concurrent } = await api(path, "PATCH", { updated_at: baseline.updated_at,
    metadata: { ...baseline.metadata, duration: { zh: "Legacy timing", en: "Concurrent legacy EN" }, legacyConcurrentUnknown: true } });
  const rejected = page.waitForResponse(r => r.request().method() === "PATCH" && r.status() === 409);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await rejected;
  await page.getByRole("button", { name: "Compare latest", exact: true }).click();
  await page.getByRole("button", { name: "Keep my edits on this revision", exact: true }).click();
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.status() === 200);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await saved;
  const { item: after } = await api(path);
  expect(after.metadata).toEqual({ ...concurrent.metadata, duration: { zh: "Legacy authored ZH", en: "Concurrent legacy EN" } });
  await page.reload(); await expect(field).toHaveValue("Legacy authored ZH");
  record("F27-legacy-conflict", { parentId: parent.id, actual409: true, legacyBaseline: "plain string", metadata: after.metadata, reloadEqual: true }); await ctx.close();
});
