import { expect, test, type Browser } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const enabled = process.env.ADFOCATE_BROWSER_SCOPE === "D17_R2";
const fx = enabled ? JSON.parse(readFileSync(".codex-tmp/R2-ui-fixture.private.json", "utf8")) : {};
test.beforeEach(() => test.skip(!enabled, "Use the identity-gated D17 R2 runner."));
const record = (name: string, data: unknown) => writeFileSync(`docs/verification/D17-R2-${name}-${process.env.D17_R2_PHASE}.json`, JSON.stringify({ runId: fx.runId, data }, null, 2) + "\n");
const creatorPaths = ["/home", "/my", "/wallet", "/redemption/history", "/campaigns", "/guide"];
const staffPaths = ["/admin/creators", "/admin/insights", "/admin/applications", "/admin/campaigns", "/admin/content"];

async function context(browser: Browser, staff = false, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(session => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, (staff ? fx.operator : fx.creator).session);
  await ctx.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["56400", "56421"].includes(url.port) ? route.continue() : route.abort();
  });
  return ctx;
}

test("D17 R2 admin heading remains fully readable beside workspace, role and account", async ({ browser }) => {
  const ctx = await context(browser, true, 1280), page = await ctx.newPage(), cells = [];
  await page.goto("/admin/applications");
  await expect(page.getByText("No pending applications", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Staff role")).toBeVisible();
  for (const width of [1024, 1280, 1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator("header"), heading = header.getByRole("heading", { level: 1 });
    const dimensions = await heading.evaluate(el => ({ width: el.clientWidth, contentWidth: el.scrollWidth, text: el.textContent }));
    cells.push({ viewportWidth: width, ...dimensions });
    expect.soft(dimensions.width, `heading has readable space at ${width}`).toBeGreaterThan(0);
    expect.soft(dimensions.contentWidth, `full heading at ${width}`).toBeLessThanOrEqual(dimensions.width + 1);
    await expect(header.getByRole("button", { name: /Sign out/i })).toBeVisible();
    await expect(header.getByRole("combobox", { name: "workspace", exact: true })).toBeVisible();
    if (width === 1280) await header.screenshot({ path: `docs/verification/D17-R2-heading-${process.env.D17_R2_PHASE}.png`, mask: [header.locator("span").filter({ hasText: "@" })] });
  }
  record("heading", cells); await ctx.close();
});

test("D17 R2 current core and supporting pages reflow at 360, 390, 768 and 320 CSS pixels", async ({ browser }) => {
  const cells = [];
  for (const staff of [false, true]) {
    const ctx = await context(browser, staff), page = await ctx.newPage();
    for (const path of staff ? [...staffPaths, `/admin/academy/${fx.tracks[0].id}`] : creatorPaths) {
      await page.goto(path); await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      for (const width of [360, 390, 768, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        const overflow = dimensions.scroll > dimensions.viewport + 1 ? await page.evaluate(() => [...document.querySelectorAll("main *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })).slice(0, 15)) : [];
        cells.push({ path, width, ...dimensions, overflow });
        record("responsive", { cells, partial: true });
        expect.soft(dimensions.scroll, `${path} width ${width}`).toBeLessThanOrEqual(dimensions.viewport + 1);
      }
    }
    await ctx.close();
  }
  record("responsive", { cells, nativeZoom: false, physicalDevice: false, note: "320 CSS px is reflow coverage; no native browser zoom claim." });
});

test("D17 R2 current core, supporting pages and parent form pass selected automated A and AA checks", async ({ browser }) => {
  const scans = [];
  for (const staff of [false, true]) {
    const ctx = await context(browser, staff), page = await ctx.newPage();
    for (const path of staff ? [...staffPaths, `/admin/academy/${fx.tracks[0].id}`] : creatorPaths) {
      await page.goto(path); await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle"); await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const result = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (node: Document, options: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
        return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }));
      });
      scans.push({ path, violations: result }); expect.soft(result, path).toEqual([]);
    }
    await ctx.close();
  }
  record("axe", { version: require("axe-core/package.json").version, scans, manualAT: false });
});

test("D17 R2 keyboard retry preserves parent input and mobile navigation remains usable", async ({ browser }) => {
  const ctx = await context(browser, true), page = await ctx.newPage();
  await page.goto(`/admin/academy/${fx.tracks[0].id}`);
  const field = page.getByRole("textbox", { name: "Learning time (中文)", exact: true });
  await expect(field).toBeVisible(); await field.fill("Unsaved keyboard review");
  await field.focus(); await expect(field).toBeFocused(); await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Level label (中文)", exact: true })).toBeFocused();
  const menu = page.locator('button[aria-controls="admin-mobile-nav"]');
  await menu.focus(); await page.keyboard.press("Enter"); await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAccessibleName("Close navigation");
  await menu.focus(); await page.keyboard.press("Enter"); await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(field).toHaveValue("Unsaved keyboard review");
  await page.route("**/api/admin/content?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"explicit local quality fault"}' }));
  await page.goto("/admin/content"); await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("combobox", { name: /Content status/ }).selectOption("draft");
  const retry = page.getByRole("button", { name: /Retry/ }); await retry.focus();
  await page.unroute("**/api/admin/content?*"); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Content status/ })).toHaveValue("draft");
  record("keyboard", { parentInputPreserved: true, parentSaved: false, nativeTab: true, menuKeyboardToggle: true, error503: "explicit transport mock", recovery: "real local read", filterRetained: true });
  await ctx.close();
});

test("D17 R2 records current production-asset lab page timings and 100 real scoped queue reads", async ({ browser }) => {
  test.skip(process.env.D17_R2_PHASE !== "final" && !process.env.D17_R2_PHASE?.startsWith("profile-"), "Performance requires a production asset build.");
  const pages = [];
  for (const staff of [false, true]) {
    const ctx = await context(browser, staff, 1280), page = await ctx.newPage();
    await page.addInitScript(() => {
      const values = { lcp: 0, shifts: [] as { at: number; value: number; sources: unknown[] }[] };
      (window as unknown as { qualityVitals: typeof values }).qualityVitals = values;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) values.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node: Element | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
        if (!shift.hadRecentInput) values.shifts.push({ at: shift.startTime, value: shift.value, sources: shift.sources.map(source => ({ tag: source.node?.tagName, className: source.node?.className, previous: source.previousRect.toJSON(), current: source.currentRect.toJSON() })) });
      } }).observe({ type: "layout-shift", buffered: true });
    });
    for (const path of staff ? [...staffPaths, `/admin/academy/${fx.tracks[0].id}`] : creatorPaths) {
      const start = performance.now(); await page.goto(path); await expect(page.getByRole("heading").first()).toBeVisible(); await page.waitForLoadState("networkidle");
      const values = await page.evaluate(() => (window as unknown as { qualityVitals: { lcp: number; shifts: { at: number; value: number }[] } }).qualityVitals);
      let startWindow = 0, last = 0, sum = 0, cls = 0;
      for (const shift of values.shifts) { if (shift.at - last > 1000 || shift.at - startWindow > 5000) { startWindow = shift.at; sum = 0; } sum += shift.value; last = shift.at; cls = Math.max(cls, sum); }
      pages.push({ path, toNetworkIdleMs: performance.now() - start, lcpMs: values.lcp || null, cls, shifts: values.shifts });
    }
    if (staff) {
      const token = await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token") ?? "{}").access_token as string);
      const requests = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const response = await page.request.get("/api/admin/creators/review?page=1", { headers: { Authorization: `Bearer ${token}`, "X-Workspace-Slug": fx.slug } });
        const body = await response.json(); expect(response.status()).toBe(200); expect(body.total).toBe(2); expect(body.creators.map((row: { id: string }) => row.id).sort()).toEqual([fx.creator.id, fx.other.id].sort());
        requests.push({ ms: performance.now() - start, status: response.status(), total: body.total, rows: body.creators.length });
      }
      const sorted = requests.map(r => r.ms).sort((a, b) => a - b);
      record("performance", { browser: browser.version(), pages, requests, api: { samples: sorted.length, p50: sorted[49], p95: sorted[94], max: sorted[99] },
        environment: "1280x900 desktop Edge, loopback, no CPU/network throttling; external requests aborted, fallback fonts; HTTP cache disabled by routing, warm DB/server; sequential navigation.",
        scope: "Current 12 pages and a real two-Creator owned queue. Earlier 1k/10k, 24 interaction and INP samples remain historical; no new scale, native-device, field p75 or hosted claim. toNetworkIdle includes the idle wait and is distinct from LCP/INP.",
        thresholds: { lcpMs: 2500, cls: 0.1, apiP95Ms: 800 }, inp: "NOT_MEASURED_THIS_RUN" });
    }
    await ctx.close();
  }
  for (const sample of pages) expect.soft(sample.cls, `${sample.path} CLS budget`).toBeLessThanOrEqual(0.1);
});
