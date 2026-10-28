import { expect, test, type Browser } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
const fixture = process.env.ADFOCATE_BROWSER_SCOPE === "D14" ? JSON.parse(readFileSync(".codex-tmp/D14-fixture.private.json", "utf8")) : {};
test.beforeEach(() => test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D14", "Use the identity-gated D14 runner."));
const record = (name: string, value: Record<string, unknown>) => writeFileSync(`docs/verification/D14-${name}.json`, JSON.stringify({ runId: fixture.runId, ...value }, null, 2) + "\n");
async function context(browser: Browser, lang = "en", actor?: { session: unknown }, mobile = true) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  await ctx.addInitScript(({ lang, session }) => { localStorage.setItem("lang", lang); if (session) localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, { lang, session: actor?.session });
  await ctx.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["56400", "56421"].includes(url.port) ? route.continue() : route.abort(); });
  return ctx;
}
async function api(path: string, actor = fixture.creator) {
  const response = await fetch(`http://127.0.0.1:56400/api${path}`, { headers: { Authorization: `Bearer ${actor.jwt}`, "X-Workspace-Slug": fixture.slug } });
  expect(response.status).toBe(200); return response.json();
}

test("D14 public pages identify illustrative claims and use canonical XP in both languages and viewports", async ({ browser }) => {
  const coverage: Record<string, unknown>[] = [];
  for (const lang of ["en", "zh"]) for (const mobile of [true, false]) {
    const ctx = await context(browser, lang, undefined, mobile), page = await ctx.newPage();
    for (const path of ["/", "/creators"]) {
      await page.goto(path);
      await expect(page.getByRole("note", { name: lang === "en" ? "Product preview" : "產品預覽" })).toBeVisible();
      await expect(page.getByText(lang === "en" ? "Illustrative profile · fictional data" : "示範履歷 · 虛構資料", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(lang === "en" ? "L2 Trusted KOC" : "L2 信譽 KOC", { exact: true }).first()).toBeVisible();
      await expect(page.locator(".xp-bar-fill").first()).toHaveAttribute("style", "width: 46%;");
      await expect(page.locator("body")).not.toContainText(/5,200\+|120\+|Lifetime withdrawable earnings|可提取累計收入/);
      if (path === "/creators") {
        await expect(page.getByText(lang === "en" ? "Course topics preview · content in preparation" : "課程主題預覽 · 內容準備中", { exact: true })).toBeVisible();
        await page.locator("section").filter({ has: page.getByText(lang === "en" ? "Illustrative profile · fictional data" : "示範履歷 · 虛構資料", { exact: true }) }).screenshot({ path: `docs/verification/D14-creators-${lang}-${mobile ? "mobile" : "desktop"}.png` });
      }
      coverage.push({ lang, viewport: mobile ? "390x844" : "1280x900", path, level: "L2", next: "L3", xp: 3840, nextXP: 6000, progressPercent: 46 });
    }
    await ctx.close();
  }
  record("public-ui", { coverage, data: "fictional samples; no production performance claim" });
});

test("D14 five contact previews retain drafts, send no data and show no receipt after refresh", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  const writes: string[] = [];
  page.on("request", request => { if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await page.goto("/contact");
  for (const tab of ["Brand Enquiry", "Creator Signup", "Adfoplace Offer", "Capital Waitlist", "Partner Enquiry"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const form = page.locator("form:visible");
    for (const input of await form.locator("input[required]").all()) {
      const type = await input.getAttribute("type");
      if (type === "checkbox") await input.check();
      else await input.fill(type === "email" ? "d14-preview@example.invalid" : type === "number" ? "5000" : "Retained preview draft");
    }
    await form.getByRole("button", { name: "Preview form", exact: true }).click();
    await expect(page.getByText("Preview only. Nothing was sent or saved.", { exact: true }).last()).toBeVisible();
    await expect(form.locator('input[name="name"]')).toHaveValue("Retained preview draft");
    await expect(page.getByRole("heading", { name: /Thanks|Received/ })).toHaveCount(0);
  }
  await page.getByRole("tab", { name: "Brand Enquiry", exact: true }).click();
  await expect(page.locator('form:visible input[name="name"]')).toHaveValue("Retained preview draft");
  expect(writes).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("Retained preview draft"); expect(stored).not.toContain("d14-preview@example.invalid");
  await page.reload();
  await expect(page.locator('form:visible input[name="name"]')).toHaveValue("");
  await expect(page.getByRole("heading", { name: /Thanks|Received/ })).toHaveCount(0);
  record("contact-ui", { tabs: 5, retainedAcrossPreviewAndTabs: true, writes, storedDraft: false, receiptAfterRefresh: false });
  await ctx.close();
});

test("D14 operator creates a resource body, reloads it, publishes and filters tracks separately", async ({ browser }) => {
  const ctx = await context(browser, "en", fixture.operator, false), page = await ctx.newPage();
  await page.goto("/admin/academy/new");
  await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("resource");
  const title = `D14 browser resource ${fixture.runId}`;
  await page.getByRole("textbox", { name: "Title (中文)", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Excerpt (中文)", exact: true }).fill("Owned browser resource overview");
  await page.getByRole("textbox", { name: "Body (中文)", exact: true }).fill("## Browser resource body\n\nOwned, readable acceptance content.");
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill(`d14-browser-${fixture.runId}`);
  await expect(page.getByRole("heading", { name: "Browser resource body", exact: true })).toBeVisible();
  const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/academy" && response.request().method() === "POST" && response.status() === 201);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const { item } = await (await created).json();
  await expect(page).toHaveURL(new RegExp(`/admin/academy/${item.id}`));
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title (中文)", exact: true })).toHaveValue(title);
  await expect(page.getByRole("textbox", { name: "Body (中文)", exact: true })).toHaveValue(item.body_zh);
  const published = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/academy/${item.id}/publish` && response.status() === 200);
  await page.getByRole("button", { name: "Publish", exact: true }).click(); await published;
  const reloaded = (await api(`/admin/academy/${item.id}`, fixture.operator)).item;
  expect(reloaded.status).toBe("published"); expect(reloaded.body_zh).toBe(item.body_zh);
  const bundle = await api("/academy");
  expect(bundle.resources.some((row: { id: string }) => row.id === item.id)).toBe(true);
  expect(bundle.tracks.some((row: { id: string }) => row.id === item.id)).toBe(false);
  await page.goto("/admin/academy");
  await page.getByRole("combobox", { name: "Content kind", exact: true }).selectOption("track");
  await expect(page.getByRole("cell", { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: fixture.rows.ready.title_zh, exact: true })).toBeVisible();
  record("author-ui", { ownedContentId: item.id, slug: item.slug, created: true, bodyPersistedAfterReload: true, status: reloaded.status, resourceExcludedFromTrackFilter: true });
  await ctx.close();
});

test("D14 Creator reads persisted content, sees preparing and retains the trust gate and read retry", async ({ browser }) => {
  const ctx = await context(browser, "en", fixture.untrusted), page = await ctx.newPage();
  await page.goto(`/guide/track/${fixture.rows.empty.slug}`);
  await expect(page.getByRole("heading", { name: "Content preparing", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Introduction", exact: true })).toBeVisible();
  const seen = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me/level-seen" && response.status() === 200);
  await page.getByRole("dialog", { name: "You levelled up!", exact: true }).getByRole("button", { name: "Awesome!", exact: true }).click();
  await seen;
  await expect(page.locator("body")).not.toContainText(/4 lessons|4堂課|Start course/);
  await page.goto(`/guide/track/${fixture.rows.ready.slug}`);
  await expect(page.getByRole("heading", { name: "合成課程正文", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("Revision two.", { exact: true })).toBeVisible();
  await page.goto(`/guide/track/${fixture.rows.gated.slug}`);
  await expect(page.getByRole("link", { name: "Verify now", exact: true })).toHaveAttribute("href", "/profile");
  await expect(page.getByRole("heading", { name: "Gated reading body", exact: true })).toHaveCount(0);
  let transientResponses = 0;
  const pattern = `**/api/academy/track/${fixture.rows.ready.slug}?*`;
  await page.route(pattern, route => { transientResponses++; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary offline fixture" }) }); });
  await page.goto(`/guide/track/${fixture.rows.ready.slug}`);
  await expect(page.getByRole("alert")).toContainText("Content could not be loaded");
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "合成課程正文", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/verification/D14-creator-reading.png" });
  record("creator-ui", { bodyPersistedAfterRefresh: true, introductionSeparated: true, noInventedLessons: true, trustGateRetained: true,
    retry: { status: 503, explicitlyMockedResponses: transientResponses, recovery: "retry reads real persisted local API data" } });
  await ctx.close();
});
