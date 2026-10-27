import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import process from "node:process";

const file = ".codex-tmp/D13-fixture.private.json";
const fixture = process.env.ADFOCATE_BROWSER_SCOPE === "D13" ? JSON.parse(readFileSync(file, "utf8")) : {};
test.beforeEach(() => test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D13", "Use the identity-gated D13 runner."));
const record = (name: string, values: Record<string, unknown>) => writeFileSync(`docs/verification/D13-${name}.json`, JSON.stringify({ runId: fixture.runId, ...values }, null, 2) + "\n");
async function context(browser: Browser, lang = "en") {
  const value = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await value.addInitScript(language => localStorage.setItem("lang", language), lang);
  await value.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" && ["56400", "56421"].includes(url.port) ? route.continue() : route.abort(); });
  return value;
}
async function signIn(page: Page, actor: { email: string; password: string }, lang = "en") {
  await page.getByLabel(lang === "en" ? "Email address" : "電郵地址", { exact: true }).fill(actor.email);
  await page.getByLabel(lang === "en" ? "Password" : "密碼", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: lang === "en" ? "Sign in" : "登入", exact: true }).click();
}
async function api<T>(path: string) {
  const response = await fetch(`http://127.0.0.1:56400/api${path}`, { headers: { Authorization: `Bearer ${fixture.creator.jwt}`, "X-Workspace-Slug": fixture.slug } });
  expect(response.status).toBe(200); return await response.json() as T;
}

test("D13 login keeps one email, hides account existence and recovers an expired return link", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto("/login?next=%2Fprofile");
  await expect(page.getByRole("heading", { name: "Sign in to Adfocate", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: "docs/verification/D13-login.png" });
  await page.getByLabel("Email address", { exact: true }).fill(fixture.creator.email);
  await page.getByLabel("Password", { exact: true }).fill("Incorrect-fixture-password!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(fixture.creator.email);
  let messages = 0; page.on("request", req => { if (req.url().includes("/auth/v1/otp")) messages++; });
  await page.getByRole("button", { name: "Choose an email sign-in link", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(fixture.creator.email);
  expect(messages).toBe(0);
  await page.goto("/auth/callback?next=%2Fprofile#error=access_denied&error_code=otp_expired");
  await expect(page.getByRole("alert")).toContainText("expired");
  const retry = page.getByRole("link", { name: "Request a new sign-in link", exact: true });
  await expect(retry).toHaveAttribute("href", "/login?next=%2Fprofile");
  await retry.click(); await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
  record("auth-recovery", { singleEmail: true, wrongCredentialsRetainInput: true, methodChangeSendsNothing: true, expiredFragmentRecovered: true, safeReturnPreserved: true });
  await ctx.close();
});

test("D13 profile cancel, recoverable save and Passport reload preserve the same sources", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await page.goto("/profile"); await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
  await signIn(page, fixture.creator); await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText(`@${fixture.canonicalHandle}`, { exact: true })).toHaveCount(1);
  await expect(page.getByText("@legacy_video", { exact: true })).toBeVisible();
  await expect(page.getByText("Conflicting handles", { exact: true })).toBeVisible();
  const before = await api<{ display_name: string; social_accounts: unknown; social_handles: unknown }>("/me");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Display Name", { exact: true }).fill("Discarded synthetic edit");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await api<{ display_name: string }>("/me")).display_name).toBe(before.display_name);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Display Name", { exact: true }).fill("D13 saved synthetic identity");
  let fail = true;
  await page.route("**/api/me/profile", route => fail && route.request().method() === "PUT" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "unavailable" }) }) : route.continue());
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Display Name", { exact: true })).toHaveValue("D13 saved synthetic identity");
  fail = false;
  const saved = page.waitForResponse(res => new URL(res.url()).pathname === "/api/me/profile" && res.request().method() === "PUT" && res.status() === 200);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await saved;
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible(); await page.reload();
  const loaded = await api<{ display_name: string; social_accounts: unknown; social_handles: unknown }>("/me");
  expect(loaded.display_name).toBe("D13 saved synthetic identity"); expect(loaded.social_handles).toEqual(before.social_handles);
  await page.goto("/passport");
  await expect(page.getByText(`@${fixture.canonicalHandle}`, { exact: true })).toBeVisible();
  await expect(page.getByText("@legacy_video", { exact: true })).toBeVisible();
  const passport = await api<{ socialTrust: { presentations: unknown } }>("/me/passport");
  expect(passport.socialTrust.presentations).toEqual(loaded.social_accounts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("Social Accounts", { exact: true }).locator("..").screenshot({ path: "docs/verification/D13-social-passport.png" });
  const created = page.waitForResponse(res => new URL(res.url()).pathname === "/api/me/passport/share" && res.request().method() === "POST");
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const share = await (await created).json(); fixture.authSecrets.push(share.token, share.publicUrl); writeFileSync(file, JSON.stringify(fixture));
  const anonymous = await context(browser), view = await anonymous.newPage();
  await view.goto(share.publicUrl); await expect(view.getByText("Approved synthetic highlight", { exact: true })).toBeVisible();
  await expect(view.getByText(`@${fixture.canonicalHandle}`, { exact: true })).not.toBeVisible();
  const revoked = page.waitForResponse(res => new URL(res.url()).pathname === "/api/me/passport/share" && res.request().method() === "DELETE");
  await page.getByRole("button", { name: "Revoke link", exact: true }).click(); expect((await revoked).status()).toBe(200);
  await view.reload(); await expect(view.getByText("Passport unavailable", { exact: true })).toBeVisible();
  record("profile-roundtrip", { cancelledWithoutWrite: true, save503RetainedInput: true, savedAfterRetryAndReload: true, projectionConsistent: true, legacyAndCanonicalUnchanged: true,
    approvedHighlightVisible: true, privateHandlesNotPublic: true, publicLinkRevoked: true, noHorizontalOverflow390px: true });
  await anonymous.close(); await ctx.close();
});

test("D13 onboarding resumes after a reload, skips optional socials and retains a unique welcome", async ({ browser }) => {
  const ctx = await context(browser, "zh"), page = await ctx.newPage();
  await page.goto("/mission"); await signIn(page, fixture.fresh, "zh"); await expect(page).toHaveURL(/\/onboarding\?next=%2Fmission$/);
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.getByRole("button", { name: "美容", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByText("你的平台", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("你的平台", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "略過", exact: true }).click();
  await expect(page.getByText("你的第一個任務", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "領取 100 積分", exact: true }).click();
  await expect(page.getByRole("link", { name: "繼續原先操作", exact: true })).toHaveAttribute("href", "/mission");
  await page.reload(); await expect(page.getByRole("button", { name: "領取 100 積分", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "繼續原先操作", exact: true }).click();
  await expect(page).toHaveURL(/\/mission$/); await expect(page.getByRole("heading", { name: "限時任務", exact: true })).toBeVisible();
  record("onboarding-roundtrip", { persistedStepAfterReload: 3, optionalSocialSkipped: true, completedReloadDoesNotOfferBonusAgain: true, requestedMissionListReached: true });
  await ctx.close();
});

test("D13 recovery UI validates then updates a real local Auth account (PKCE transport mocked)", async ({ browser }) => {
  const ctx = await context(browser), page = await ctx.newPage();
  await ctx.addInitScript(() => localStorage.setItem("sb-127-auth-token-code-verifier", JSON.stringify("d13-mocked-verifier/PASSWORD_RECOVERY")));
  await page.route("**/auth/v1/token?grant_type=pkce", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.recoverySession) }));
  await page.goto("/auth/reset-password?code=d13-mocked-pkce&next=%2Fprofile");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  const secret = `Browser-recovered-${randomUUID()}!`; fixture.authSecrets.push(secret); writeFileSync(file, JSON.stringify(fixture));
  await page.getByLabel("New password", { exact: true }).fill(secret);
  await page.getByLabel("Confirm new password", { exact: true }).fill("does-not-match");
  let updates = 0; page.on("request", req => { if (new URL(req.url()).pathname === "/auth/v1/user" && req.method() === "PUT") updates++; });
  await page.getByRole("button", { name: "Save new password", exact: true }).click(); expect(updates).toBe(0);
  await page.getByLabel("Confirm new password", { exact: true }).fill(secret);
  const saved = page.waitForResponse(res => new URL(res.url()).pathname === "/auth/v1/user" && res.request().method() === "PUT");
  await page.getByRole("button", { name: "Save new password", exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/profile$/); expect(updates).toBe(1);
  record("recovery-ui", { pkceExchange: "mocked using a valid owned local session", localAuthPasswordUpdate: "real", mismatchBlockedBeforeUpdate: true, singleUpdate: true, safeReturnReached: true });
  await ctx.close();
});
