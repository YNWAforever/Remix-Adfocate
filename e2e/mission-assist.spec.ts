import { test, expect, type Page } from "@playwright/test";
import fixture from "../tests/fixtures/assistant-workflow-eval.json" with { type: "json" };
const id = fixture.ids;
const reply = { answer: "Include #ad. Human review required.", citations: [{ title: "v1", sourceType: "mission_assist", sourceRef: `version:${id.v1}` }],
  basisVersion: { missionId: id.mission, missionUpdatedAt: null, workflowId: id.workflow, workflowRevision: 1, workItemId: id.item, versionId: id.v1, versionNumber: 1, previousVersionId: null, previousVersionApproved: false, versionApproved: true, currentVersionId: id.v2, stale: true, sourceHash: "offline-hash" },
  limitations: ["human_review_required", "no_business_actions", "payment_and_processing_date_unknown"], persistence: "not_saved", generation: "completed", provider: "mock", request_id: id.request };
async function prepare(page: Page, lang = "en") {
  const external: string[] = [], unexpected: string[] = [];
  await page.addInitScript(lang => localStorage.setItem("lang", lang), lang);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || url.port !== "56500") { external.push(url.origin); return route.abort(); }
    if (url.pathname.startsWith("/api/")) { unexpected.push(url.pathname); return route.abort(); }
    return route.continue();
  });
  return { external, unexpected };
}

for (const staff of [false, true]) test(`D20 ${staff ? "operator" : "creator"} lazy checklist, disabled provider and keyboard close`, async ({ page }) => {
  const net = await prepare(page), loaded: string[] = [];
  page.on("request", r => { if (r.url().includes("/MissionAssistPanel.tsx")) loaded.push(r.url()); });
  await page.goto(`/e2e/fixtures/mission-assist.html${staff ? "?staff=1" : ""}`);
  await expect(page.getByRole("button", { name: "Brief help", exact: true })).toBeVisible();
  expect(loaded).toHaveLength(0);
  if (!staff) await page.locator('textarea[name="caption"]').fill("Preserve my draft caption");
  await page.getByRole("button", { name: "Brief help", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Brief coach" })).toContainText("Include #ad");
  await expect(page.getByRole("button", { name: "Explain with AI" })).toBeDisabled();
  expect(loaded.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close help" }).click();
  await expect(page.getByRole("button", { name: "Brief help", exact: true })).toBeFocused();
  if (!staff) await expect(page.locator('textarea[name="caption"]')).toHaveValue("Preserve my draft caption");
  expect(net.external).toEqual([]); expect(net.unexpected).toEqual([]);
});

for (const lang of ["en", "zh"]) test(`D20 mock ${lang} sources and stale warning retain the question`, async ({ page }) => {
  const net = await prepare(page, lang), calls: Record<string, unknown>[] = [];
  if (lang === "zh") await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/admin/assistant/mission-assist", route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: reply }); });
  await page.goto("/e2e/fixtures/mission-assist.html?mock=1&staff=1");
  await page.getByLabel(lang === "en" ? "Question about this brief or version" : "關於這個 brief 或版本的問題").fill("Preserve this question");
  await page.getByRole("button", { name: lang === "en" ? "Explain with AI" : "AI 解說", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(lang === "en" ? "old version" : "舊版本");
  await expect(page.getByLabel(lang === "en" ? "Sources" : "來源")).toContainText(`version:${id.v1}`);
  await expect(page.getByText(lang === "en" ? "Selected version: current approved snapshot." : "所選版本：目前批准的快照。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/verification/D20-mock-panel-${lang}.png`, fullPage: true });
  await expect(page.locator("textarea")).toHaveValue("Preserve this question");
  expect(calls).toHaveLength(1); expect(calls[0].assist_context).toMatchObject({ versionId: id.v1, mode: "summarize_changes" });
  expect(net.external).toEqual([]); expect(net.unexpected).toEqual([]);
});

test("D20 unknown outcome does not retry; 429 retry retains ID; 409 stops with input intact", async ({ page }) => {
  const net = await prepare(page), calls: Record<string, unknown>[] = [];
  await page.route("**/api/assistant/mission-assist", route => {
    calls.push(route.request().postDataJSON()); return route.fulfill({ status: calls.length === 1 ? 503 : calls.length === 2 ? 429 : 409, json: { code: "bounded_error", error: "Offline mock failure" } });
  });
  await page.goto("/e2e/fixtures/mission-assist.html?mock=1");
  await page.locator("textarea").fill("Keep input on failure");
  await page.getByRole("button", { name: "Explain with AI" }).click();
  await expect(page.getByRole("alert")).toContainText("unknown"); await expect(page.getByRole("button", { name: "Explain with AI" })).toBeDisabled();
  expect(calls).toHaveLength(1);
  await page.getByRole("button", { name: "Start a new question" }).click(); await page.getByRole("button", { name: "Explain with AI" }).click();
  await expect(page.getByRole("alert")).toContainText("Too many requests");
  await page.getByRole("button", { name: "Explain with AI" }).click();
  await expect(page.getByRole("alert")).toContainText("source changed");
  await expect(page.getByRole("button", { name: "Explain with AI" })).toBeDisabled();
  await expect(page.locator("textarea")).toHaveValue("Keep input on failure");
  expect(calls[1].client_request_id).toBe(calls[2].client_request_id); expect(calls[0].client_request_id).not.toBe(calls[1].client_request_id);
  expect(net.external).toEqual([]); expect(net.unexpected).toEqual([]);
});

test("D20 ignores a delayed v1 mock after switching to v2", async ({ page }) => {
  const net = await prepare(page);
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  let calls = 0;
  await page.route("**/api/assistant/mission-assist", async route => { calls++; await held; await route.fulfill({ json: reply }).catch(() => {}); });
  await page.goto("/e2e/fixtures/mission-assist.html?mock=1"); await page.locator("textarea").fill("Keep while changing version");
  await page.getByRole("button", { name: "Explain with AI" }).click(); await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "Switch to v2" }).click(); release();
  await expect(page.getByRole("button", { name: "Explain with AI" })).toBeEnabled();
  await expect(page.getByText("Mock output · not saved · human review required", { exact: true })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveValue("Keep while changing version");
  expect(net.external).toEqual([]); expect(net.unexpected).toEqual([]);
});
