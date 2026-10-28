import { describe, expect, it } from "vitest";
// @ts-expect-error executable launcher has no declaration file
import { assertIntegrationEnvironment } from "../../scripts/run-integration-tests.mjs";

const env = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_KEY: "synthetic-service",
  SUPABASE_ANON_KEY: "synthetic-anon",
};

describe("integration identity before client creation", () => {
  it("does not treat a loopback address as authorization or container identity", () => {
    expect(() => assertIntegrationEnvironment(env)).toThrow(/identity/i);
  });
  it("rejects an identity document pointing through an unverified proxy", () => {
    expect(() => assertIntegrationEnvironment({ ...env,
      INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify({ projectId: "test", proxy: "unknown" }),
    })).toThrow(/identity/i);
  });
});
