// Operator browser journeys. Staff sign-in is Google OAuth only, so tests inject the real
// local Supabase session for a fixture staff user into the SPA's storage key.
import { expect, test, type Page } from "@playwright/test";
import { defect, knownBug } from "./bug";
import { joinAndSubmit, newCreator, newMission, newStaff, sql, q, type Actor } from "../support/fixture";

async function injectSession(page: Page, actor: Actor) {
  const { data } = await actor.client.auth.getSession();
  const key = `sb-${new URL(process.env.SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => { localStorage.setItem("lang", "en"); localStorage.setItem(k, v); }, [key, JSON.stringify(data.session)]);
}

test("reviewer sees a newly submitted item in the legacy queue and can approve it", async ({ page }) => {
  const creator = await newCreator();
  const reviewer = await newStaff("reviewer");
  const m = newMission({ points: 90 });
  const sid = await joinAndSubmit(creator, m.slug);
  await injectSession(page, reviewer);
  await page.goto(`/admin/submissions?submission_id=${sid}`);
  const approve = page.getByRole("button", { name: /approve|批准/i }).first();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => sql(`select status from public.mission_submissions where id=${q(sid)};`)).toBe("approved");
});

knownBug("F-004", "declining a submission in the UI asks for a reason / confirmation before it is final", async ({ page }) => {
  const creator = await newCreator();
  const reviewer = await newStaff("reviewer");
  const m = newMission();
  const sid = await joinAndSubmit(creator, m.slug);
  await injectSession(page, reviewer);
  await page.goto(`/admin/submissions?submission_id=${sid}`);
  page.on("dialog", d => void d.dismiss()); // a native confirm, if any, is dismissed
  await page.getByRole("button", { name: /decline|拒絕/i }).first().click();
  await page.waitForTimeout(2000);
  const status = sql(`select status from public.mission_submissions where id=${q(sid)};`);
  await defect(() => expect(status).toBe("submitted"));
});

knownBug("F-016", "a finance_viewer opening /admin lands on a page they are allowed to use", async ({ page }) => {
  const finance = await newStaff("finance_viewer");
  await injectSession(page, finance);
  await page.goto("/admin");
  await page.waitForLoadState("networkidle");
  // Observed: lands on /admin/insights with "Workspace access is required. Contact the owner." although
  // the role is valid; the only page this role may use is Reward handoffs.
  await expect(page.getByText(/Reward handoffs/i).first()).toBeVisible();
  await defect(() => expect(page.getByText(/Workspace access is required|requires an assigned staff capability/i)).toHaveCount(0, { timeout: 2000 }));
});
