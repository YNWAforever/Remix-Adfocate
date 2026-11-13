// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({ create: vi.fn((...input: unknown[]) => ({ input })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: clients.create }));
const project = "mhkoayftiuojxlrkollf";
const commit = "92f5712bb9b23c9c363ae349a6ade6625f4c8120";
beforeEach(() => { vi.resetModules(); clients.create.mockClear(); vi.stubEnv("SUPABASE_URL", `https://${project}.supabase.co`);
  vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-public"); vi.stubEnv("SUPABASE_SERVICE_KEY", "synthetic-service"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("public release health binding", () => {
  it("keeps local/unidentified health metadata empty", async () => {
    const { deploymentHealthMetadata } = await import("./releaseHealth");
    expect(deploymentHealthMetadata({})).toEqual({});
    expect(deploymentHealthMetadata({ VERCEL_GIT_COMMIT_SHA: "synthetic-invalid-value" })).toEqual({});
  });
  it("returns only immutable deployment commit and the public backend project reference", async () => {
    const { deploymentHealthMetadata } = await import("./releaseHealth");
    expect(deploymentHealthMetadata({ VERCEL_GIT_COMMIT_SHA: commit })).toEqual({ applicationCommit: commit, apiProjectRef: project });
    expect(clients.create).not.toHaveBeenCalled();
  });
  it("uses the exact captured URL used by both backend clients even if process env changes later", async () => {
    const db = await import("./supabase");
    const { deploymentHealthMetadata } = await import("./releaseHealth");
    vi.stubEnv("SUPABASE_URL", "https://differentprojectrefx.supabase.co");
    db.makeUserClient("synthetic-user-session"); db.serviceClient();
    expect(clients.create.mock.calls.map(call => call[0])).toEqual([`https://${project}.supabase.co`, `https://${project}.supabase.co`]);
    expect(deploymentHealthMetadata({ VERCEL_GIT_COMMIT_SHA: commit }).apiProjectRef).toBe(project);
  });
  it.each(["http://127.0.0.1:54321", "https://custom.example.test", "not-a-url", `https://${project}.supabase.co/unexpected`,
    `https://${project}.supabase.co?unexpected=1`])("marks unsupported backend binding unknown for %s", async url => {
    vi.stubEnv("SUPABASE_URL", url);
    const { deploymentHealthMetadata } = await import("./releaseHealth");
    expect(deploymentHealthMetadata({ VERCEL_GIT_COMMIT_SHA: commit })).toEqual({ applicationCommit: commit, apiProjectRef: null });
  });
});
