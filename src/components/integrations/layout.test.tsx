import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { integrationKeys } from "@/lib/integrations/queries";
import type { IntegrationConnection, IntegrationResource } from "@/lib/integrations/types";
import { Connections } from "./Connections";
import { ConnectionConsent } from "./ConnectionConsent";
import { IntegrationSourcePanel } from "./IntegrationSourcePanel";
const integrationCss = readFileSync(resolve("src/components/integrations/integrations.css"), "utf8");
const studioCss = readFileSync(resolve("src/components/studio/studio.css"), "utf8");

vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@tanstack/react-router", async original => ({ ...await original<object>(), Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));

// No downloads, server or remote pages: render the actual components in an offline browser.
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
const drive: IntegrationConnection = { id: "drive-1", provider: "google_drive", label: "Mock sample account", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file"], generation: 1, lastSyncAt: null, expiresAt: "2099-01-01T00:00:00Z", lastError: null, sampleOnly: true, providerRevocation: "not_requested" };
const source: IntegrationResource = { id: "r1", connectionId: "drive-1", externalId: "doc1", title: "A long mock document title to check narrow source panels", mimeType: "text/plain", version: "a-long-snapshot-version-without-any-breakpoints-01234567890123456789", selected: true, canDownload: true, rights: "owned", availability: "available", excerpt: "Mock excerpt", metrics: { views: { value: 0, availability: "available", reason: null }, reach: { value: null, availability: "missing", reason: null } }, observedAt: "2026-10-31T00:00:00Z", fetchedAt: "2026-10-31T00:00:00Z", coverage: { region: null, language: null, partial: true }, sampleOnly: true };
let browser: Browser, page: Page;
const clients: QueryClient[] = [];
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(integrationKeys.list(), { mode: "mock", connections: [drive] });
  vi.mocked(apiFetch).mockResolvedValue({ resources: [source] });
  return render(<QueryClientProvider client={client}><div className="studio"><div className="s-content">{children}</div></div></QueryClientProvider>);
}
async function snapshot(width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0} ${studioCss}\n${integrationCss}</style></head><body>${document.body.innerHTML}</body></html>`);
}
async function expectNoOverflowAndTouchTargets() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  const small = await page.locator(".i-button,.i-text-button,summary,.i-check,.i-file,.i-field select,.i-field textarea").evaluateAll(nodes => nodes.flatMap(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.height < 44 ? [{ text: node.textContent?.slice(0,60), height: rect.height }] : [];
  }));
  expect(small).toEqual([]);
}

describe.skipIf(!executablePath)("offline responsive integration components", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    page = await browser.newPage({ offline: true, reducedMotion: "reduce" });
    await page.route("**/*", route => route.abort());
  });
  afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
  afterAll(async () => { await browser?.close(); });

  it.each([320,390,430,768,1024,1440])("fits all eight provider cards with 44px actions at %ipx", async width => {
    mount(<Connections />); await snapshot(width);
    await expectNoOverflowAndTouchTargets();
    const columns = await page.locator(".i-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width >= 768 ? 2 : 1);
    expect(await page.locator(".i-card,.i-later").count()).toBe(8);
  });

  it.each([320,390,430,768,1024,1440])("contains full consent scopes and dialog actions at %ipx", async width => {
    render(<ConnectionConsent request={{ state: "mock", provider: "google_drive", scopes: drive.scopes, expiresAt: drive.expiresAt, sampleOnly: true }} busy={false} error={null} onCancel={() => {}} onComplete={() => {}} />);
    await snapshot(width); await expectNoOverflowAndTouchTargets();
    const rect = await page.locator('[role="dialog"]').boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    expect(rect!.height).toBeLessThanOrEqual(900);
    expect(await page.locator(".i-button").first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  });

  it.each([320,390,430,768,1024,1440])("keeps evidence fields and metrics inside the narrow panel at %ipx", async width => {
    mount(<div style={{ maxWidth: 300 }}><IntegrationSourcePanel threadId="thread-1" revision={3} onImported={() => {}} /></div>);
    await screen.findByRole("checkbox", { name: /A long mock document/ });
    fireEvent.click(screen.getByText("Source, excerpt & rights"));
    await waitFor(() => expect(screen.getByText("Mock excerpt")).toBeVisible());
    await snapshot(width); await expectNoOverflowAndTouchTargets();
    expect(await page.locator(".i-metrics").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(2);
  });

  it.each([320,390,430,768,1024,1440])("fits D0 boundaries and expanded proposed scopes at %ipx", async width => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
    client.setQueryData(integrationKeys.list(), { mode: "live_pilot", pilot: { stage: "D0", externalAccess: false }, connections: [{ ...drive, status: "revoked", providerRevocation: "pending" }] });
    render(<QueryClientProvider client={client}><div className="studio"><div className="s-content"><Connections /></div></div></QueryClientProvider>);
    document.querySelectorAll("details").forEach(details => { details.open = true; });
    await snapshot(width); await expectNoOverflowAndTouchTargets();
    expect(await page.getByRole("note", { name: "D0 offline verification" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Live Google Drive connection unavailable in D0" }).isDisabled()).toBe(true);
    expect(await page.getByText("openid", { exact: true }).count()).toBe(1);
  });

  it.each([320,390,430,768,1024,1440])("keeps dialog actions reachable in a reduced-height viewport at %ipx", async width => {
    render(<ConnectionConsent request={{ state: "mock", provider: "google_drive", scopes: [...drive.scopes, "openid"], expiresAt: drive.expiresAt, sampleOnly: true }} busy={false} error={null} onCancel={() => {}} onComplete={() => {}} />);
    await snapshot(width, 360); await expectNoOverflowAndTouchTargets();
    const action = page.getByRole("button", { name: "Allow mock connection" });
    await action.focus();
    const box = await action.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(360);
    expect(await page.locator('[role="dialog"]').evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  });
});
