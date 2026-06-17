import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("social trust schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets a creator read only their own social trust account", async () => {
    const c1 = await makeCreator("social-schema-1@test.local");
    const c2 = await makeCreator("social-schema-2@test.local");
    const svc = serviceForTests();

    const { error: insertErr } = await svc.from("creator_social_accounts").insert([
      {
        creator_id: c1.userId,
        workspace_id: DEMO_WS,
        platform: "instagram",
        handle: "ming",
        profile_url: "https://www.instagram.com/ming/",
        sync_status: "synced",
        follower_count: 12000,
        api_synced_at: new Date().toISOString(),
      },
      {
        creator_id: c2.userId,
        workspace_id: DEMO_WS,
        platform: "threads",
        handle: "other",
        profile_url: "https://www.threads.net/@other",
        sync_status: "synced",
        follower_count: 5000,
        api_synced_at: new Date().toISOString(),
      },
    ]);
    expect(insertErr).toBeNull();

    const user = userForJwt(c1.jwt);
    const { data, error } = await user
      .from("creator_social_accounts")
      .select("creator_id, platform, handle, follower_count")
      .order("platform");

    expect(error).toBeNull();
    expect(data).toEqual([
      {
        creator_id: c1.userId,
        platform: "instagram",
        handle: "ming",
        follower_count: 12000,
      },
    ]);
  });

  it("keeps public passport token hashes private to the owning creator", async () => {
    const c1 = await makeCreator("social-passport-token-1@test.local");
    const c2 = await makeCreator("social-passport-token-2@test.local");
    const svc = serviceForTests();

    const { error: insertErr } = await svc.from("creator_public_passports").insert([
      { creator_id: c1.userId, public_token_hash: "hash-for-c1", enabled: true },
      { creator_id: c2.userId, public_token_hash: "hash-for-c2", enabled: true },
    ]);
    expect(insertErr).toBeNull();

    const user = userForJwt(c1.jwt);
    const { data, error } = await user.from("creator_public_passports").select("creator_id, public_token_hash");

    expect(error).toBeNull();
    expect(data).toEqual([{ creator_id: c1.userId, public_token_hash: "hash-for-c1" }]);
  });
});
