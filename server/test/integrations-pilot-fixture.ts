import { readFile, readdir } from "node:fs/promises";
import { fixture } from "./helpers/integrations-fixture.js";
export * from "./helpers/integrations-fixture.js";

/** New-migration loader only; the shared 4A-C fixture remains unchanged. */
export async function pilotFixture() {
  const value = await fixture();
  const files = (await readdir("supabase/migrations")).filter(name => name.endsWith("_integration_pilot_persistence.sql")).sort();
  for (const file of files) await value.db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  return value;
}
