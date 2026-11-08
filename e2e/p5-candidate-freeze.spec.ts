import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createControlledPilotMockApp } from "../server/lib/creatorGrowth/pilot/mockApp.js";
import { openDurablePilot } from "../server/lib/creatorGrowth/pilot/durableRuntime.js";

const widths = [320, 390, 430, 1024, 1440];
const roles = [
  { role: "creator", path: "/home", staff: null },
  { role: "brand", path: "/brand", staff: null },
  { role: "reviewer", path: "/admin/active-missions", staff: /Reviewer/i },
  { role: "operator", path: "/admin/reward-handoffs", staff: /Operator/i },
  { role: "workspace_admin", path: "/admin/reward-handoffs", staff: /Admin/i },
  { role: "finance_viewer", path: "/admin/reward-handoffs", staff: /Finance viewer/i },
] as const;
type Actor = typeof roles[number];
// Chrome routes every request before network access. This origin has no listener.
const origin = "http://127.0.0.1:18865";
const dist = resolve(".superpowers/p5-candidate-browser-dist");
const fixtureRoot = resolve(".superpowers/p5-candidate-browser-db");
const csp = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
  "form-action 'none'", "frame-ancestors 'none'", "base-uri 'none'",
].join("; ");
const journeyName = "同一任務模擬交接";
const operationName = "營運試點準備";

async function fixtureContext(browser: Browser, width: number, actor: Actor,
  app: ReturnType<typeof createControlledPilotMockApp>, index: Buffer) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, locale: "zh-HK", timezoneId: "Asia/Hong_Kong",
    serviceWorkers: "block",
  });
  const escaped: string[] = [];
  const pilotReads: string[] = [];
  await context.addInitScript(({ fixtureOrigin, role }) => {
    if (location.origin !== fixtureOrigin) return;
    if (!sessionStorage.getItem("kocmax-local-preview-role")) {
      sessionStorage.setItem("kocmax-local-preview-role", role);
    }
    localStorage.setItem("lang", "zh");
  }, { fixtureOrigin: origin, role: actor.role });
  await context.routeWebSocket(/.*/, socket => {
    escaped.push("websocket");
    socket.close();
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && request.method() === "GET") {
      if (request.isNavigationRequest() && [actor.path, actor.path + "/"].includes(url.pathname)) {
        return route.fulfill({ status: 200, body: index, contentType: "text/html; charset=utf-8",
          headers: { "content-security-policy": csp, "cache-control": "no-store" } });
      }
      if (/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?|png|webp|jpe?g|svg)$/.test(url.pathname)) {
        return route.fulfill({ path: resolve(dist, "." + url.pathname) });
      }
      if (["/api/controlled-pilot-mock/journey", "/api/controlled-pilot-mock/operator"].includes(url.pathname)) {
        const reply = await app.fetch(new Request(url, { headers: await request.allHeaders() }));
        pilotReads.push(`${url.pathname}:${reply.status}`);
        return route.fulfill({
          status: reply.status, headers: Object.fromEntries(reply.headers),
          body: Buffer.from(await reply.arrayBuffer()),
        });
      }
    }
    // Never forward browser traffic. Ignore only the browser's default icon lookup.
    if (url.origin === origin && url.pathname === "/favicon.ico") return route.fulfill({ status: 404 });
    escaped.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  return { context, escaped, pilotReads };
}

async function checkRole(page: Page, actor: Actor, width: number) {
  await expect(page.getByText("本機示例 · 無真實連接", { exact: true })).toBeVisible();
  await expect(page.getByLabel("示例角色", { exact: true })).toHaveValue(actor.role);
  await expect(page).toHaveURL(url => url.origin === origin &&
    url.pathname.replace(/\/$/, "") === actor.path);
  const journey = page.getByRole("region", { name: journeyName });
  const operations = page.getByRole("complementary", { name: operationName });
  if (actor.staff) {
    await expect(page.getByLabel("Staff role", { exact: true })).toContainText(actor.staff);
  }
  switch (actor.role) {
    case "creator":
      await expect(page.getByRole("link", { name: "開啟試點任務", exact: true })).toBeVisible();
      await expect(page.locator("#root").getByRole("heading", { level: 1 })).toBeVisible();
      await expect(operations).toHaveCount(0);
      break;
    case "brand":
      await expect(page.getByRole("heading", { name: "茶日和 · 品牌工作區（示例）", exact: true })).toBeVisible();
      await expect(page.locator('a[href="/brand/missions/new"]').first()).toBeVisible();
      await expect(journey).toHaveCount(0);
      break;
    case "reviewer":
      await expect(page.locator("#active-mission-queue-heading")).toBeVisible();
      await expect(journey.getByText("等待發佈與證明", { exact: true })).toBeVisible();
      await expect(operations).toHaveCount(0);
      break;
    case "operator":
    case "workspace_admin":
      await expect(page.locator("#reward-handoff-sla-heading")).toBeVisible();
      await expect(journey.getByText("本機模擬積分：0 · 帳本記錄：0", { exact: true })).toBeVisible();
      await expect(operations.getByText(/模擬發佈 0 · 真實證明 0 · 真實獎勵 0/)).toBeVisible();
      break;
    case "finance_viewer":
      await expect(page.locator("#reward-handoff-sla-heading")).toBeVisible();
      await expect(page.locator("#reward-handoff-sla-heading").locator("..").getByRole("button")).toHaveCount(0);
      await expect(journey).toHaveCount(0);
      await expect(operations).toHaveCount(0);
      break;
  }
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(viewport.width).toBe(width);
  expect(viewport.overflow, `${actor.role} at ${width}px`).toBeLessThanOrEqual(1);
}

for (const width of widths) {
  test(`zero-post synthetic role matrix at ${width}px`, async ({ browser }) => {
    await mkdir(fixtureRoot, { recursive: true });
    const directory = await mkdtemp(resolve(fixtureRoot, "run-"));
    const runtime = await openDurablePilot(directory);
    try {
      const index = await readFile(resolve(dist, "index.html"));
      const app = createControlledPilotMockApp(runtime.pilot, runtime.journey, runtime.privateWorkspace);
      for (const actor of roles) {
        await test.step(`${actor.role} ${actor.path}`, async () => {
          const { context, escaped, pilotReads } = await fixtureContext(browser, width, actor, app, index);
          try {
            const page = await context.newPage();
            const errors: string[] = [];
            page.on("pageerror", error => errors.push(error.message));
            expect((await page.goto(origin + actor.path))?.status()).toBe(200);
            await checkRole(page, actor, width);
            if (width === 390 || width === 1440) {
              expect((await page.reload())?.status()).toBe(200);
              await checkRole(page, actor, width);
            }
            if (["reviewer", "operator", "workspace_admin"].includes(actor.role)) {
              expect(pilotReads).toContain("/api/controlled-pilot-mock/journey:200");
            } else {
              expect(pilotReads).toEqual([]);
            }
            expect(errors).toEqual([]);
            expect(escaped).toEqual([]);
          } finally {
            await context.close();
          }
        });
      }
      expect(runtime.pilot.counts()).toMatchObject({ publish: 0, proof: 0, reward: 0 });
    } finally {
      await runtime.close();
    }
  });
}
