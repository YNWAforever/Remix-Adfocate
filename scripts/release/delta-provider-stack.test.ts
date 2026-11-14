// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOwnedProviderStack, providerLoopbackOrigin } from "./delta-provider-stack";

describe("owned provider loopback target", () => {
  it("accepts only the exact numeric IPv4 loopback HTTP origin", () => { expect(providerLoopbackOrigin("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321"); });
  it.each(["https://mhkoayftiuojxlrkollf.supabase.co", "http://localhost:54321", "https://127.0.0.1:54321", "http://127.0.0.1:80", "http://127.0.0.1:54321/override", "http://fixture:fixture@127.0.0.1:54321", "http://127.0.0.1:54321/?target=remote", "http://[::1]:54321", undefined])("refuses hosted, redirected, credentialed and ambiguous routes", value => { expect(() => providerLoopbackOrigin(value)).toThrow("Provider rehearsal held"); });
});

describe.skipIf(process.env.RUN_PROVIDER_STACK !== "1")("actual owned provider stack lifecycle", () => {
  it("creates a fresh CLI-pinned local provider stack and confirms exact cleanup", async () => {
    const stack = await createOwnedProviderStack(fileURLToPath(new URL("../../", import.meta.url)));
    try {
      expect(stack.identities.length).toBeGreaterThanOrEqual(5); await stack.assertOwned();
      const rows = await stack.sql("SELECT json_build_object('database',current_database(),'version',current_setting('server_version_num'));");
      expect(JSON.parse(rows[0]!)).toMatchObject({ database: "postgres" }); expect(JSON.parse(rows[0]!).version).toMatch(/^17/);
    } finally { await stack.close(); }
  }, 900_000);
});
