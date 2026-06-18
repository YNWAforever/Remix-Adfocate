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

  it("blocks creators from inserting or updating scan-derived social metrics", async () => {
    const creator = await makeCreator("social-schema-metrics@test.local");
    const user = userForJwt(creator.jwt);
    const svc = serviceForTests();

    const { error: insertErr } = await user.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "notreallysynced",
      profile_url: "https://www.instagram.com/notreallysynced/",
      sync_status: "synced",
      follower_count: 999999,
      api_synced_at: new Date().toISOString(),
    });

    expect(insertErr).not.toBeNull();

    const { data: created, error: safeInsertErr } = await user
      .from("creator_social_accounts")
      .insert({
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        platform: "instagram",
        handle: "realhandle",
        profile_url: "https://www.instagram.com/realhandle/",
      })
      .select("id, follower_count, sync_status, api_synced_at, updated_at")
      .single();

    expect(safeInsertErr).toBeNull();
    expect(created).toMatchObject({
      follower_count: null,
      sync_status: "pending",
      api_synced_at: null,
    });
    if (!created) throw new Error("Expected created social account row");

    const firstUpdatedAt = created.updated_at;
    const { error: updateErr } = await user
      .from("creator_social_accounts")
      .update({
        follower_count: 12000,
        sync_status: "synced",
      })
      .eq("id", created.id);

    expect(updateErr).not.toBeNull();

    const { data: afterBlockedUpdate, error: reloadErr } = await svc
      .from("creator_social_accounts")
      .select("handle, profile_url, follower_count, sync_status, api_synced_at, updated_at")
      .eq("id", created.id)
      .single();

    expect(reloadErr).toBeNull();
    expect(afterBlockedUpdate).toMatchObject({
      handle: "realhandle",
      profile_url: "https://www.instagram.com/realhandle/",
      follower_count: null,
      sync_status: "pending",
      api_synced_at: null,
      updated_at: firstUpdatedAt,
    });

    const { data: renamed, error: allowedUpdateErr } = await user
      .from("creator_social_accounts")
      .update({
        handle: "realhandle.renamed",
        profile_url: "https://www.instagram.com/realhandle.renamed/",
      })
      .eq("id", created.id)
      .select("handle, profile_url, updated_at")
      .single();

    expect(allowedUpdateErr).toBeNull();
    expect(renamed).toMatchObject({
      handle: "realhandle.renamed",
      profile_url: "https://www.instagram.com/realhandle.renamed/",
    });
    if (!renamed) throw new Error("Expected renamed social account row");
    expect(new Date(renamed.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(firstUpdatedAt).getTime());
  });

  it("blocks creators from inserting or updating passport token hashes directly", async () => {
    const creator = await makeCreator("social-passport-write@test.local");
    const user = userForJwt(creator.jwt);
    const svc = serviceForTests();

    const { error: insertErr } = await user.from("creator_public_passports").insert({
      creator_id: creator.userId,
      public_token_hash: "client-forged-hash",
      enabled: true,
    });

    expect(insertErr).not.toBeNull();

    const { error: seedErr } = await svc.from("creator_public_passports").insert({
      creator_id: creator.userId,
      public_token_hash: "service-hash",
      enabled: true,
    });

    expect(seedErr).toBeNull();

    const { error: updateErr } = await user
      .from("creator_public_passports")
      .update({ public_token_hash: "client-rotated-hash" })
      .eq("creator_id", creator.userId);

    expect(updateErr).not.toBeNull();

    const { data, error } = await svc
      .from("creator_public_passports")
      .select("creator_id, public_token_hash, enabled")
      .eq("creator_id", creator.userId)
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({
      creator_id: creator.userId,
      public_token_hash: "service-hash",
      enabled: true,
    });
  });
});
