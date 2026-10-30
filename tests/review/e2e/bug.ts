// Playwright counterpart of tests/review/support/bug.ts: only a failure inside `defect(...)`
// counts as the documented defect; any other failure (setup, navigation) fails the test.
import { test, type Browser, type Page } from "@playwright/test";

class DefectObserved extends Error {}

export async function defect(assertion: () => Promise<void> | void): Promise<void> {
  try { await assertion(); } catch (e) { throw new DefectObserved(e instanceof Error ? e.message : String(e)); }
}

type Fixtures = { page: Page; browser: Browser };
export function knownBug(id: string, title: string, fn: (f: Fixtures) => Promise<void>): void {
  test(`[${id}] KNOWN BUG — ${title}`, async ({ page, browser }) => {
    try {
      await fn({ page, browser });
    } catch (e) {
      if (e instanceof DefectObserved) return;
      throw e;
    }
    throw new Error(`${id} appears FIXED (defect assertion passed). Remove the knownBug marker.`);
  });
}
