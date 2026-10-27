import { expect, test } from "@playwright/test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { randomUUID } from "node:crypto";
import type { ActiveMissionWorkspace, MissionPublicationView } from "../src/lib/activeMission";
const fixture = JSON.parse(readFileSync(".codex-tmp/D12-fixture.private.json", "utf8"));

test("D12 unsaved navigation keeps the authored input until discard is confirmed", async ({ browser }) => {
  test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D12", "Use the identity-guarded authoring runner.");
  const context = await browser.newContext();
  await context.addInitScript((session) => { localStorage.setItem("lang", "zh"); localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, fixture.operator.session);
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage();
  const path = `/admin/missions/${fixture.navMission.id}`;
  await page.goto(path);
  await page.getByLabel("標題", { exact: true }).fill("未保存的作者輸入");
  let prompts = 0;
  const dialogTypes: string[] = [];
  page.on("dialog", async dialog => { prompts++; dialogTypes.push(dialog.type()); await dialog.dismiss(); });
  await page.getByRole("button", { name: "管理", exact: true }).click();
  expect(prompts).toBe(1);
  await expect(page.getByLabel("標題", { exact: true })).toHaveValue("未保存的作者輸入");
  await page.getByRole("navigation").getByRole("link", { name: "任務", exact: true }).click();
  await expect.poll(() => prompts).toBe(2);
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?|$)`));
  expect(new URL(page.url()).searchParams.get("ws")).toBe(fixture.workspaceId);
  await expect(page.getByLabel("標題", { exact: true })).toHaveValue("未保存的作者輸入");
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => prompts).toBe(3);
  expect(dialogTypes[2]).toBe("beforeunload");
  expect(page.isClosed()).toBe(false);
  await expect(page.getByLabel("標題", { exact: true })).toHaveValue("未保存的作者輸入");
  page.removeAllListeners("dialog");
  page.once("dialog", async dialog => { prompts++; await dialog.accept(); });
  await page.getByRole("button", { name: "管理", exact: true }).click();
  await expect(page).toHaveURL(/tab=manage/);
  await expect(page.getByLabel("標題", { exact: true })).toHaveCount(0);
  writeFileSync("docs/verification/D12-navigation.json", JSON.stringify({ runId: fixture.runId,
    dismissKeepsInput: true, spaLeaveCancelled: true, beforeUnloadCancelled: true, confirmedTabLeave: true, prompts, dialogTypes, externalActions: "none" }, null, 2) + "\n");
  await context.close();
});

test("D12 readable authoring preview saves, reloads and reaches the same Creator publication guidance", async ({ browser, request }) => {
  test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D12", "Use the identity-guarded authoring runner.");
  const context = await browser.newContext();
  await context.addInitScript((session) => { localStorage.setItem("lang", "zh"); localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, fixture.operator.session);
  let failSave = true, createRequests = 0, unexpectedDialogs = 0;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/api/admin/missions" && route.request().method() === "POST") {
      createRequests++;
      if (failSave) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "db_error", error: "Synthetic save outage" }) });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("dialog", async dialog => { unexpectedDialogs++; await dialog.dismiss(); });
  await page.goto("/admin/missions/new");
  await page.getByLabel("標題", { exact: true }).fill("D12 合成作者任務");
  const slug = `d12-ui-${fixture.runId}`;
  await page.getByLabel("任務網址代號", { exact: true }).fill(slug);
  await page.getByLabel("分類", { exact: true }).selectOption("寵物");
  await page.getByLabel("積分獎勵", { exact: true }).fill("500");
  await page.getByLabel("現金獎勵", { exact: true }).fill("125");
  await page.getByLabel("截止日期", { exact: true }).fill(fixture.navMission.deadline);
  await page.getByLabel("任務簡介", { exact: true }).fill("Synthetic authoring acceptance, no external publication");
  await page.getByRole("button", { name: "instagram", exact: true }).click();
  await page.getByLabel("交付流程", { exact: true }).selectOption("active_workspace");
  await page.getByRole("button", { name: "新增交付項目", exact: true }).click();
  await page.getByLabel("交付標題 1", { exact: true }).fill("合成短片交付");
  await page.getByLabel("交付平台 1", { exact: true }).fill("instagram");
  await page.getByLabel("交稿時限 1", { exact: true }).fill("24");
  await page.getByLabel("發佈指示 1", { exact: true }).fill("發布已批准的短片及清楚披露合作");
  await page.getByLabel("發佈時限小時 1", { exact: true }).fill("48");
  await page.getByLabel("必須披露字句 1", { exact: true }).fill("#廣告\n品牌合作");
  await page.getByLabel("預期帳戶 1", { exact: true }).fill("@synthetic_creator");
  await page.getByRole("checkbox", { name: "需要佐證檔案 1", exact: true }).check();
  await page.getByRole("button", { name: "新增交付 1 檢查要求", exact: true }).click();
  await page.getByLabel("交付 1 檢查 1 要求類別", { exact: true }).selectOption("compliance");
  await page.getByLabel("交付 1 檢查 1 要求內容", { exact: true }).fill("短片須清楚披露合作");
  await expect(page.getByLabel("發佈證明要求 1", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "預覽", exact: true }).click();
  const preview = page.getByRole("region", { name: "Creator 預覽", exact: true });
  for (const text of ["合成短片交付", "短片須清楚披露合作", "發布已批准的短片及清楚披露合作", "#廣告", "品牌合作", "@synthetic_creator", "批准後 48 小時內", "需要至少一份佐證檔案"]) await expect(preview).toContainText(text);
  expect(createRequests).toBe(0);
  await preview.screenshot({ path: "docs/verification/D12-authoring-preview.png" });
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("儲存失敗");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("標題", { exact: true })).toHaveValue("D12 合成作者任務");
  await expect(page.getByRole("checkbox", { name: "需要佐證檔案 1", exact: true })).toBeChecked();
  failSave = false;
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/missions" && response.request().method() === "POST" && response.status() === 201);
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  const authored = (await (await saved).json()).mission;
  appendFileSync(".codex-tmp/D12-ui-fixtures.private.jsonl", JSON.stringify({ runId: fixture.runId, workspaceId: fixture.workspaceId, missionId: authored.id,
    templateIds: authored.deliverable_templates.map((item: { id: string }) => item.id), slug }) + "\n");
  await expect(page).toHaveURL(/\/admin\/missions(?:\?|$)/);
  await expect(page.getByRole("button", { name: "編輯", exact: true }).first()).toBeVisible();
  expect(unexpectedDialogs).toBe(0);
  expect(createRequests).toBe(2);
  const headers = (jwt: string) => ({ Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": fixture.slug, "Idempotency-Key": randomUUID() });
  async function api<T>(jwt: string, path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await request.fetch(`/api${path}`, { method, headers: headers(jwt), ...(body === undefined ? {} : { data: body }) });
    expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(200);
    return response.json();
  }
  await page.goto(`/admin/missions/${authored.id}`);
  await page.reload();
  await expect(page.getByLabel("交付標題 1", { exact: true })).toHaveValue("合成短片交付");
  await expect(page.getByLabel("發佈時限小時 1", { exact: true })).toHaveValue("48");
  await expect(page.getByRole("checkbox", { name: "需要佐證檔案 1", exact: true })).toBeChecked();
  const reloaded = (await api<{ mission: typeof authored }>(fixture.operator.jwt, `/admin/missions/${authored.id}`)).mission;
  expect(reloaded.deliverable_templates).toEqual(authored.deliverable_templates);
  await page.getByRole("navigation").getByRole("link", { name: "任務", exact: true }).click();
  const row = page.getByText("D12 合成作者任務", { exact: true }).locator("xpath=../../..");
  const published = page.waitForResponse(response => response.url().includes(`/missions/${authored.id}/publish`) && response.request().method() === "POST");
  await row.getByRole("button", { name: "發佈", exact: true }).click();
  expect((await published).status()).toBe(200);
  // Only this disposable mission changes to active. No external content is published.
  const creatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await creatorContext.addInitScript(() => localStorage.setItem("lang", "en"));
  await creatorContext.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const creator = await creatorContext.newPage();
  await creator.goto("/login");
  await creator.locator('input[type="email"]').first().fill(fixture.creator.email);
  await creator.locator('input[type="password"]').fill(fixture.creator.password);
  await creator.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(creator).toHaveURL(/\/home$/);
  await expect(creator.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  await creator.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Find missions", exact: true }).click();
  await expect(creator).toHaveURL(/\/mission(?:\?|$)/);
  await expect(creator.getByRole("heading", { name: "Missions", exact: true })).toBeVisible();
  await creator.locator(`a[href="/mission/${slug}"]`).click();
  const joined = creator.waitForResponse(response => response.url().endsWith(`/${slug}/join`) && response.request().method() === "POST");
  await creator.getByRole("button", { name: "Join Mission", exact: true }).click();
  const join = await joined; expect(join.status()).toBe(200);
  const submissionId = (await join.json()).submission.id;
  const read = () => api<ActiveMissionWorkspace>(fixture.creator.jwt, `/my-missions/${submissionId}/workspace`);
  const workspace = await read(), item = workspace.workItems.find(value => value.required)!;
  expect(item.title).toBe("合成短片交付");
  // @ts-expect-error Native ESM local identity utility has no declaration file.
  const { verifiedTarget } = await import("../scripts/audit/local-targets.mjs");
  // @ts-expect-error Native ESM local SQL utility has no declaration file.
  const { neutralitySnapshot } = await import("../scripts/audit/neutrality-snapshot.mjs");
  const target = verifiedTarget("empty"), before = neutralitySnapshot(target, fixture.creator.id, fixture.workspaceId);
  await creator.goto(`/my/${submissionId}?item=${item.id}`);
  await creator.getByRole("textbox", { name: "Caption or copy", exact: true }).fill("Synthetic authored draft");
  await creator.getByRole("checkbox", { name: /短片須清楚披露合作/ }).check();
  await expect.poll(async () => (await read()).workItems.find(value => value.id === item.id)!.draft?.caption).toBe("Synthetic authored draft");
  await creator.getByRole("button", { name: "Submit version", exact: true }).click();
  await expect.poll(async () => (await read()).workItems.find(value => value.id === item.id)!.state).toBe("submitted");
  const submittedItem = (await read()).workItems.find(value => value.id === item.id)!;
  const operatorPath = `/admin/active-missions/${workspace.workflow.id}/work-items/${item.id}`;
  await api(fixture.operator.jwt, `${operatorPath}/start-review`, "POST", { expectedState: "submitted" });
  await api(fixture.operator.jwt, `${operatorPath}/approve-to-publish`, "POST", { expectedState: "under_review", versionId: submittedItem.currentSubmittedVersionId });
  const publication = (await api<{ publication: MissionPublicationView }>(fixture.creator.jwt, `/my-missions/${submissionId}/publication/${item.id}`)).publication;
  expect(publication.instructions).toMatchObject({ publicationInstructions: "發布已批准的短片及清楚披露合作",
    requiredDisclosures: ["#廣告", "品牌合作"], expectedAccount: "@synthetic_creator", proofEvidencePolicy: { required: true } });
  await creator.reload();
  const guidance = creator.getByRole("region", { name: "Publication instructions", exact: true });
  for (const text of ["發布已批准的短片及清楚披露合作", "#廣告", "品牌合作", "@synthetic_creator", "Evidence is required"]) await expect(guidance).toContainText(text);
  await guidance.screenshot({ path: "docs/verification/D12-creator-guidance.png" });
  expect(await creator.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  writeFileSync("docs/verification/D12-browser-before.json", JSON.stringify({ runId: fixture.runId, snapshot: before }, null, 2) + "\n");
  writeFileSync("docs/verification/D12-authoring-roundtrip.json", JSON.stringify({ runId: fixture.runId, missionId: authored.id,
    submissionId, workflowId: workspace.workflow.id, workItemId: item.id, templateIds: reloaded.deliverable_templates.map((value: { id: string }) => value.id),
    noJsonRequired: true, previewDidNotSave: true, save503RetainedInput: true, savedAndReloaded: true,
    creatorWorkspaceAndPublicationGuidanceMatch: true, publicationInstructions: publication.instructions,
    creatorViewport: { width: 390, height: 844 }, noHorizontalOverflow: true, unexpectedSaveDialogs: unexpectedDialogs,
    isolatedMissionStatus: "active", externalSocialPublication: "not performed", review: "existing real operator API; not a new proof/completion handoff" }, null, 2) + "\n");
  await creatorContext.close(); await context.close();
});

test("D12 unknown advanced rules survive a readable edit and hard reload", async ({ browser }) => {
  test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D12", "Use the identity-guarded authoring runner.");
  const context = await browser.newContext();
  await context.addInitScript((session) => { localStorage.setItem("lang", "zh"); localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); }, fixture.operator.session);
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage(), path = `/admin/missions/${fixture.navMission.id}`;
  await page.goto(path);
  await page.getByLabel("標題", { exact: true }).fill("N02 可讀編輯保留舊規則");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api${path}` && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "儲存變更", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("button", { name: "編輯", exact: true }).first()).toBeVisible();
  await page.goto(path); await page.reload();
  await expect(page.getByText(/已有進階設定會原樣保留/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "需要佐證檔案 1", exact: true })).toBeDisabled();
  await page.getByText("進階設定（JSON）", { exact: true }).click();
  const policy = JSON.parse(await page.getByLabel("發佈證明要求 1", { exact: true }).inputValue());
  expect(policy).toEqual({ screenshots: 1, legacy_review: { manual: true, modes: ["owner", 2] } });
  writeFileSync("docs/verification/D12-unknown-policy-roundtrip.json", JSON.stringify({ runId: fixture.runId,
    missionId: fixture.navMission.id, unknownPolicy: policy, savedAndReloaded: true, noRuleDeleted: true }, null, 2) + "\n");
  await context.close();
});
