import { expect, test, type Browser } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const fixture = process.env.ADFOCATE_BROWSER_SCOPE === "D15" ? JSON.parse(readFileSync(".codex-tmp/D15-fixture.private.json", "utf8")) : {};
test.beforeEach(() => test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D15", "Use the identity-gated Academy runner."));
const record = (name: string, value: Record<string, unknown>) => writeFileSync(`docs/verification/D15-${name}.json`, JSON.stringify({ runId: fixture.runId, ...value }, null, 2) + "\n");
async function context(browser: Browser, actor = fixture.creator, mobile = true) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  await ctx.addInitScript(session => { localStorage.setItem("lang", "en"); localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, actor.session);
  await ctx.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["56400", "56421"].includes(url.port) ? route.continue() : route.abort(); });
  return ctx;
}
async function api(path: string, actor = fixture.creator, method = "GET", body?: unknown) {
  const response = await fetch(`http://127.0.0.1:56400/api${path}`, { method, headers: { Authorization: `Bearer ${actor.jwt}`, "X-Workspace-Slug": fixture.slug, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect(response.status).toBe(method === "POST" && path.endsWith("/lessons") ? 201 : 200); return response.json();
}

test("D15 operator authors, previews, reloads and publishes two synthetic units inside the existing editor", async ({ browser }) => {
  const ctx = await context(browser, fixture.operator, false), page = await ctx.newPage();
  await page.goto(`/admin/academy/${fixture.browserTrack.id}`);
  const editor = page.getByRole("region", { name: "Lesson authoring", exact: true });
  const owned: Record<string, unknown>[] = [];
  for (let i = 1; i <= 2; i++) {
    await editor.getByRole("button", { name: "New lesson", exact: true }).click();
    await editor.getByRole("textbox", { name: "Lesson title (中文)", exact: true }).fill(`Synthetic browser unit ${i}`);
    const body = `## Synthetic browser reading ${i}\n\nAcceptance fixture only. No real curriculum approval.`;
    await editor.getByRole("textbox", { name: "Lesson body (中文)", exact: true }).fill(body);
    await editor.getByRole("spinbutton", { name: "Lesson position", exact: true }).fill(String(i - 1));
    await expect(editor.getByRole("heading", { name: `Synthetic browser reading ${i}`, exact: true })).toBeVisible();
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/admin/academy/${fixture.browserTrack.id}/lessons` && r.request().method() === "POST" && r.status() === 201);
    await editor.getByRole("button", { name: "Save lesson", exact: true }).click();
    const { item } = await (await saved).json(); owned.push(item);
    await expect(editor.getByRole("button", { name: "Publish lesson", exact: true })).toBeDisabled();
    await page.reload();
    await editor.getByRole("button", { name: new RegExp(`^Synthetic browser unit ${i} · v1 · draft`) }).click();
    await expect(editor.getByRole("textbox", { name: "Lesson body (中文)", exact: true })).toHaveValue(body);
    await editor.getByRole("textbox", { name: "Approval reference", exact: true }).fill(`SYNTHETIC ONLY/browser/${fixture.runId}`);
    const published = page.waitForResponse(r => new URL(r.url()).pathname === `/api/admin/academy/${fixture.browserTrack.id}/lessons/${item.id}/publish` && r.status() === 200);
    await editor.getByRole("button", { name: "Publish lesson", exact: true }).click(); await published;
    await expect(editor.getByText(/v1 · published · revision/)).toBeVisible();
  }
  const published = page.waitForResponse(r => new URL(r.url()).pathname === `/api/admin/academy/${fixture.browserTrack.id}/publish` && r.status() === 200);
  await page.getByRole("button", { name: "Publish", exact: true }).click(); await published;
  const learning = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`);
  expect(learning.progress).toEqual({ completed: 0, total: 2 }); expect(learning.lessons.map((l: { position: number }) => l.position)).toEqual([0, 1]);
  record("author-ui", { owned, realPersistedBodies: true, approvalRefAutomaticallyGenerated: false, courseStatus: "published", content: "explicitly synthetic only" });
  await page.screenshot({ path: "docs/verification/D15-author-editor.png" }); await ctx.close();
});

test("D15 Creator handles a mocked write failure, completes a real unit and refreshes the same saved progress", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto(`/guide/track/${fixture.browserTrack.slug}`);
  const course = page.getByRole("region", { name: "Course lessons", exact: true });
  await expect(course.getByText("0 / 2 completed", { exact: true })).toBeVisible();
  const pattern = "**/api/academy/track/*/lessons/*/complete";
  let mocked = 0;
  await page.route(pattern, route => { mocked++; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "explicit mocked unavailable write" }) }); });
  await course.getByRole("button", { name: "Mark complete", exact: true }).first().click();
  await expect(course.getByRole("alert")).toContainText("completion has not been confirmed");
  await expect(course.getByText("0 / 2 completed", { exact: true })).toBeVisible();
  await expect(course.getByRole("heading", { name: "Synthetic browser reading 1", exact: true })).toBeVisible();
  await page.unroute(pattern);
  await course.getByRole("button", { name: "Reload lessons", exact: true }).click();
  await expect(course.getByRole("alert")).toHaveCount(0);
  await course.getByRole("button", { name: "Mark complete", exact: true }).first().click();
  await expect(course.getByText("1 / 2 completed", { exact: true })).toBeVisible();
  const first = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`);
  await page.reload(); await expect(course.getByText("1 / 2 completed", { exact: true })).toBeVisible();
  const after = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`);
  expect(after).toEqual(first); expect(after.history).toHaveLength(1);
  await page.screenshot({ path: "docs/verification/D15-creator-progress.png" });
  record("creator-ui", { progress: after.progress, history: after.history, refreshEqual: true, mocked503Responses: mocked, successfulWrite: "real API/Auth/RLS/database" });
  await ctx.close();
});

test("D15 separate Creator context has zero progress and ineligible Creator cannot read locked units", async ({ browser }) => {
  const ctx = await context(browser, fixture.other), page = await ctx.newPage();
  await page.goto(`/guide/track/${fixture.browserTrack.slug}`);
  await expect(page.getByText("0 / 2 completed", { exact: true })).toBeVisible();
  const learning = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`, fixture.other);
  expect(learning.history).toEqual([]); expect(learning.lessons.every((l: { completed: boolean }) => !l.completed)).toBe(true);
  await ctx.close();
  const low = await context(browser), lowPage = await low.newPage();
  await lowPage.goto(`/guide/track/${fixture.locked.slug}`);
  await expect(lowPage.getByRole("heading", { name: "Locked unit body", exact: true })).toHaveCount(0);
  await expect(lowPage.getByRole("region", { name: "Course lessons", exact: true })).toHaveCount(0);
  record("isolation-ui", { otherProgress: learning.progress, otherHistory: learning.history, contextsSeparated: true, lockedBodyHidden: true });
  await low.close();
});

test("D15 real version conflict preserves reading and history before an explicit refresh and completion", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto(`/guide/track/${fixture.browserTrack.slug}`);
  const course = page.getByRole("region", { name: "Course lessons", exact: true });
  await expect(course.getByText("1 / 2 completed", { exact: true })).toBeVisible();
  const current = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`), second = current.lessons[1];
  const list = await api(`/admin/academy/${fixture.browserTrack.id}/lessons`, fixture.operator);
  const row = list.items.find((r: { id: string; status: string }) => r.id === second.id && r.status === "published");
  const { item: draft } = await api(`/admin/academy/${fixture.browserTrack.id}/lessons/${row.id}`, fixture.operator, "PATCH", { contentVersion: row.content_version, revision: row.revision, body_zh: "## Synthetic updated reading 2\n\nNew fixture version, explicit completion required." });
  await api(`/admin/academy/${fixture.browserTrack.id}/lessons/${draft.id}/publish`, fixture.operator, "POST", { contentVersion: draft.content_version, revision: draft.revision, approvalRef: `SYNTHETIC ONLY/v2/${fixture.runId}` });
  const conflict = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/lessons/${row.id}/complete`) && r.status() === 409);
  await course.getByRole("button", { name: "Mark complete", exact: true }).click(); await conflict;
  await expect(course.getByRole("alert")).toContainText("This lesson version changed");
  await expect(course.getByRole("heading", { name: "Synthetic browser reading 2", exact: true })).toBeVisible();
  await expect(course.getByText("1 / 2 completed", { exact: true })).toBeVisible();
  await course.getByRole("button", { name: "Reload lessons", exact: true }).click();
  await expect(course.getByRole("heading", { name: "Synthetic updated reading 2", exact: true })).toBeVisible();
  await expect(course.getByText("1 / 2 completed", { exact: true })).toBeVisible();
  const updated = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`);
  expect(updated.history).toEqual(current.history); expect(updated.lessons[1].completed).toBe(false);
  await course.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(course.getByText("2 / 2 completed", { exact: true })).toBeVisible();
  await page.reload(); await expect(course.getByText("2 / 2 completed", { exact: true })).toBeVisible();
  const after = await api(`/academy/track/${fixture.browserTrack.slug}/lessons`);
  expect(after.history).toHaveLength(2); expect(after.history).toContainEqual(current.history[0]);
  record("conflict-ui", { status: 409, transportMock: false, before: current.history, after: after.history, progress: after.progress, oldReadingPreservedUntilRefresh: true });
  await ctx.close();
});
