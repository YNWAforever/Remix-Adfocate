// Creator-facing browser journeys against the local stack (Asia/Hong_Kong, en-HK).
import { expect, test, type Page } from "@playwright/test";
import { defect, knownBug } from "./bug";
import { api, joinAndSubmit, newCreator, newMission, newStaff, newUser, type Actor } from "../support/fixture";

async function signIn(page: Page, actor: Actor) {
  await page.addInitScript(() => localStorage.setItem("lang", "en"));
  await page.goto("/login");
  await page.locator('input[type="email"]').first().fill(actor.email);
  await page.locator('input[type="password"]').fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("onboarded creator signs in, lands in the app, and sees an empty 'My missions' state", async ({ page }) => {
  const creator = await newCreator();
  await signIn(page, creator);
  await expect(page).toHaveURL(/\/home/);
  await page.goto("/my");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText(/404/)).toHaveCount(0);
});

test("brand-new account is routed into onboarding after sign-in", async ({ page }) => {
  const user = await newUser("ui-new");
  await signIn(page, user);
  await expect(page).toHaveURL(/\/onboarding/);
});

test("creator can join and submit a mission through the UI (375px, HKT)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const creator = await newCreator();
  const m = newMission({ points: 150 });
  await signIn(page, creator);
  await page.goto(`/mission/${m.slug}`);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.getByRole("button", { name: /join|accept|start/i }).first().click();
  const urlBox = page.locator("textarea").first();
  await expect(urlBox).toBeVisible();
  await urlBox.fill("https://www.instagram.com/p/review-ui/");
  await page.getByRole("button", { name: /submit/i }).first().click();
  const mine = await api("GET", "/missions/my", { jwt: creator.jwt });
  expect(JSON.stringify(mine.body)).toContain("submitted");
});

test("creator session cannot see operator data at /admin", async ({ page }) => {
  const creator = await newCreator();
  const other = await newCreator();
  const m = newMission();
  await joinAndSubmit(other, m.slug);
  await signIn(page, creator);
  const adminCalls: number[] = [];
  page.on("response", r => { if (r.url().includes("/api/admin/")) adminCalls.push(r.status()); });
  await page.goto("/admin/submissions");
  await page.waitForTimeout(2000);
  await expect(page.getByText(other.email)).toHaveCount(0);
  expect(adminCalls.every(s => s === 401 || s === 403)).toBe(true);
});

knownBug("F-010", "a rejected creator sees the reviewer's reason on the mission page", async ({ page }) => {
  const creator = await newCreator();
  const reviewer = await newStaff("reviewer");
  const m = newMission();
  const sid = await joinAndSubmit(creator, m.slug);
  const rej = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: { notes: "Lighting too dark — please reshoot" } });
  expect(rej.status).toBe(200);
  await signIn(page, creator);
  await page.goto(`/mission/${m.slug}`);
  await expect(page.getByText(/Rejected|未獲接納|已拒絕/i).first()).toBeVisible();
  await defect(() => expect(page.getByText("Lighting too dark — please reshoot")).toBeVisible({ timeout: 3000 }));
});

knownBug("F-018", "the 'visit guide' link during onboarding opens the guide", async ({ page }) => {
  const user = await newUser("ui-onb");
  await signIn(page, user);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.locator('a[href="/guide"]').first().click();
  await page.waitForLoadState("networkidle");
  await defect(() => expect(page).toHaveURL(/\/guide/, { timeout: 3000 }));
});

knownBug("F-029", "the wallet never shows HK$0.00 while earnings are still loading", async ({ page }) => {
  const creator = await newCreator();
  await signIn(page, creator);
  await page.route("**/api/wallet/earnings", async route => { await new Promise(r => setTimeout(r, 4000)); await route.continue(); });
  await page.goto("/wallet");
  await page.waitForTimeout(1000);
  await defect(() => expect(page.getByText("HK$0.00")).toHaveCount(0, { timeout: 500 }));
});

knownBug("F-026", "campaign detail shows an error (not an endless spinner) when the API fails", async ({ page }) => {
  const creator = await newCreator();
  await signIn(page, creator);
  await page.goto("/campaigns/review-does-not-exist");
  await page.waitForTimeout(4000);
  await defect(() => expect(page.getByText("…", { exact: true })).toHaveCount(0, { timeout: 500 }));
});

test("[F-002 fixed] a shared public passport page never shows the creator's email", async ({ page, browser }) => {
  const creator = await newCreator();
  const share = await api("POST", "/me/passport/share", { jwt: creator.jwt });
  const token = share.body.token ?? share.body.share?.token ?? share.body.url?.split("/").pop();
  expect(token).toBeTruthy();
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(`/passport/${token}`);
  await pub.waitForLoadState("networkidle");
  await expect(pub.getByText(creator.email)).toHaveCount(0);
  await anon.close();
  void page;
});
