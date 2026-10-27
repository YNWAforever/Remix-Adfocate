import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

// The guarded runner proves container/project identity before preparing this fixture.
const fixture = JSON.parse(readFileSync(".codex-tmp/browser-fixture.private.json", "utf8"));

test("Creator navigation reaches every existing destination at 360px and preserves wallet reloads", async ({ browser }) => {
  test.skip(process.env.ADFOCATE_BROWSER_SCOPE !== "D08", "Run via node scripts/audit/run-browser.mjs navigation for a verified fresh fixture.");
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await context.addInitScript(() => localStorage.setItem("lang", "en"));
  await context.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').first().fill(fixture.creator.email);
  await page.locator('input[type="password"]').fill(fixture.creator.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const mobile = page.locator('nav[aria-label="Main navigation"]:visible');
  const primary = [["Home", "/home"], ["Find missions", "/mission"], ["My missions", "/my"], ["Wallet", "/wallet"], ["More", "/more"]];
  const viewports = [];
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(mobile.getByRole("link")).toHaveCount(5);
    for (const [label, href] of primary) {
      const link = mobile.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveAttribute("href", href);
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    viewports.push({ width, fivePrimaryDestinations: true, minimumTarget44px: true, noHorizontalOverflow: true });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/more");
  const more = page.getByRole("navigation", { name: "More", exact: true });
  const destinations = ["/campaigns", "/notifications", "/redemption", "/explore", "/guide", "/profile", "/passport", "/match"];
  for (const href of destinations) {
    const link = more.locator(`a[href="${href}"]`);
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByText("404: Not Found", { exact: true })).toHaveCount(0);
    await page.goto("/more");
  }
  await page.goto("/wallet/earnings");
  await expect(page).toHaveURL(/\/wallet$/);
  await page.reload();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole("heading", { name: /Wallet/ }).first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktop = page.locator('nav[aria-label="Main navigation"]:visible');
  await expect(desktop.getByRole("link", { name: "My missions", exact: true })).toHaveAttribute("href", "/my");
  await page.goto("/home");
  const wallet = page.getByRole("link", { name: "View wallet details", exact: true });
  await expect(wallet).toHaveAttribute("href", "/wallet");
  await wallet.click();
  await expect(page).toHaveURL(/\/wallet$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Wallet/ }).first()).toBeVisible();
  writeFileSync("docs/verification/D08-navigation.json", JSON.stringify({ runId: fixture.runId, targetProject: "adfocate-r1-empty-20261023",
    browser: "installed Edge; emulated viewports, not physical devices", viewports, moreDestinations: destinations,
    keyboard: "focus + Enter on each More link", desktopMyMissions: true, canonicalWalletAndLegacyRedirectReload: true,
    externalNetwork: "blocked", production: false }, null, 2) + "\n");
  await context.close();
});
