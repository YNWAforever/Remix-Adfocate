// Strict expected-to-fail marker. Unlike `it.fails`, a known-bug test only passes when the
// assertion wrapped in `defect(...)` fails. Setup errors, SQL errors or any other assertion
// failure make the test RED, so a broken fixture can never masquerade as a confirmed bug.
// When the defect is fixed, the test goes RED with "appears FIXED" — then delete the marker
// and turn it into a normal regression test.
import { it } from "vitest";

class DefectObserved extends Error {}

/** Wrap ONLY the assertion that demonstrates the defect. */
export function defect(assertion: () => void): void {
  try { assertion(); } catch (e) {
    if (e instanceof Error && e.name === "AssertionError") throw new DefectObserved(e.message);
    throw e;
  }
}

export function knownBug(id: string, title: string, fn: () => Promise<void> | void, timeout?: number): void {
  it(`[${id}] KNOWN BUG — ${title}`, async () => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof DefectObserved) return; // defect reproduced as documented
      throw e;
    }
    throw new Error(`${id} appears FIXED (defect assertion passed). Remove the knownBug marker.`);
  }, timeout);
}
