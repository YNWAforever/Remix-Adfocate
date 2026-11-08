// @vitest-environment node
import { vi } from "vitest";

// Execute the existing behavior cases against the additive migration without
// editing their shared fixture or replacing any production SQL implementation.
vi.mock("./helpers/integrations-fixture.js", async importOriginal => {
  const original = await importOriginal<typeof import("./helpers/integrations-fixture.js")>();
  const { readFile, readdir } = await import("node:fs/promises");
  return { ...original, fixture: async () => {
    const value = await original.fixture();
    for (const file of (await readdir("supabase/migrations")).filter(name => name.endsWith("_integration_pilot_persistence.sql")).sort()) {
      await value.db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    }
    return value;
  } };
});
await import("./integrations-sql.test.js");
