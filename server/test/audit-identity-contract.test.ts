import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createAuditFixture } from "./auditWorkflowFixture";
import type { Me, Passport } from "../../src/lib/queries/kocmax";

describe.skipIf(process.env.RUN_AUDIT_INTEGRATION !== "1")("D13 owned disposable identity contract", () => {
  let fx: Awaited<ReturnType<typeof createAuditFixture>>;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  let before: Awaited<ReturnType<Awaited<ReturnType<typeof createAuditFixture>>["neutrality"]>>;
  let fresh: (typeof fx.creators)[number];
  let recoverySession: (typeof fx.creators)[number]["session"];
  let canonicalHandle: string;
  const socialIds: string[] = [], mediaIds: string[] = [], authSecrets: string[] = [];
  const results: string[] = [];
  let avatarPath: string | undefined;
  let welcome: Record<string, unknown>;
  let sessionPolicy: Record<string, unknown>;

  async function request<T>(path: string, method = "GET", body?: unknown, status = 200, actor?: { jwt: string }) {
    const res = await app.request(`/api${path}`, { method, headers: { Authorization: `Bearer ${(actor ?? fx.creators[0]).jwt}`,
      "X-Workspace-Slug": fx.slug, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(res.status, `${method} ${path.replace(/\/passport\/[^/]+$/, "/passport/[opaque]")}`).toBe(status);
    return await res.json() as T;
  }
  beforeAll(async () => {
    const { createAuditFixture: create } = await import("./auditWorkflowFixture");
    fx = await create(); // This verifies target before the SDK, clients and setup.
    canonicalHandle = `canonical_${fx.runId.slice(0, 8)}`;
    Object.assign(process.env, { VITE_DEFAULT_WORKSPACE: fx.slug, BOOTSTRAP_WORKSPACE_SLUGS: fx.slug });
    const { createApp } = await import("../app"); app = createApp().app;
    before = await fx.neutrality(fx.creators[0].id);
    fx.must(await fx.service.from("creators").update({ social_handles: [
      { platform: "Instagram", handle: "@legacy_identity", followers: 999999, verified: true },
      { platform: "YouTube", handle: "@legacy_video", verified: true },
    ] }).eq("id", fx.creators[0].id));
    const records = fx.must(await fx.service.from("creator_social_accounts").insert([
      { creator_id: fx.creators[0].id, workspace_id: fx.workspaceId, platform: "instagram", handle: canonicalHandle, sync_status: "synced", follower_count: 123, api_synced_at: "2026-10-22T00:00:00Z", owner_verified: true },
      { creator_id: fx.creators[0].id, workspace_id: fx.workspaceId, platform: "threads", handle: "pending_identity", sync_status: "pending", owner_verified: false },
      { creator_id: fx.creators[1].id, workspace_id: fx.workspaceId, platform: "instagram", handle: "foreign_identity", sync_status: "failed", owner_verified: false },
    ]).select("id"));
    socialIds.push(...records!.map(row => row.id));
    const { createClient } = await import("@supabase/supabase-js");
    const email = `identity-fresh-${fx.runId}@example.test`, password = `Identity-${randomUUID()}!`;
    const user = fx.must(await fx.service.auth.admin.createUser({ email, password, email_confirm: true })).user!;
    fx.must(await fx.service.from("creators").insert({ id: user.id, workspace_id: fx.workspaceId, display_name: "Synthetic fresh identity", onboarding_completed: false, onboarding_step: 1 }));
    fx.must(await fx.service.from("point_balances").insert({ creator_id: user.id, workspace_id: fx.workspaceId, balance: 0 }));
    fx.must(await fx.service.from("earnings_balances").insert({ creator_id: user.id, workspace_id: fx.workspaceId, available: 0 }));
    const client = createClient(fx.target.env.SUPABASE_URL, fx.target.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const signed = fx.must(await client.auth.signInWithPassword({ email, password }));
    fresh = { id: user.id, email, password, jwt: signed.session!.access_token, session: signed.session!, client };
    const mission = await fx.mission("legacy", false, 10);
    fx.must(await fx.service.from("missions").update({ category: "美容" }).eq("id", mission.id));
    fx.recordEvidence({ caseId: "D13-identity-setup", additionalAuthIds: [fresh.id], socialIds });
  }, 60000);

  afterAll(async () => {
    if (!fx) return;
    const after = await fx.neutrality(fx.creators[0].id);
    expect(after).toEqual(before);
    writeFileSync(".codex-tmp/D13-fixture.private.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity, workspaceId: fx.workspaceId, slug: fx.slug,
      creator: fx.creators[0], recoveryActor: fx.creators[1], recoverySession, fresh, authSecrets, socialIds, mediaIds, avatarPath, canonicalHandle }, (key,value) => key === "client" ? undefined : value));
    writeFileSync("docs/verification/D13-api-contract.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity, results, socialIds, mediaIds,
      additionalAuthIds: fresh ? [fresh.id] : [], avatarObjectRetained: Boolean(avatarPath), welcome, sessionPolicy,
      neutrality: { before, after, allEqual: JSON.stringify(before) === JSON.stringify(after) },
      providers: "local Auth and Storage; no email sent (admin-generated test links); external HTTP denied; no paid scan or real notification",
      cleanup: "not-run; exact IDs retained" }, null, 2) + "\n");
    fx.recordEvidence({ caseId: "D13-identity", additionalAuthIds: fresh ? [fresh.id] : [], socialIds, mediaIds, before, after, results });
  });

  it("returns the same traceable private social projection from Profile and Passport", async () => {
    const me = await request<Me>("/me"), passport = await request<Passport>("/me/passport");
    expect(me.social_accounts).toEqual(passport.socialTrust?.presentations);
    expect(me.social_accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ handle: canonicalHandle, source: "conflict", legacyHandles: ["@legacy_identity"], ownershipVerified: true }),
      expect.objectContaining({ handle: "pending_identity", syncStatus: "pending", ownershipVerified: false }),
      expect.objectContaining({ handle: "@legacy_video", source: "legacy", ownershipVerified: false }),
    ]));
    expect(JSON.stringify(me.social_accounts)).not.toContain("foreign_identity");
    results.push("profile-passport-projection");
  });
  it("keeps canonical handles unchanged across an unrelated profile edit", async () => {
    const saved = fx.must(await fx.service.from("creator_social_accounts").select("*").eq("creator_id", fx.creators[0].id));
    await request("/me/profile", "PUT", { display_name: "Synthetic identity updated" });
    expect(fx.must(await fx.service.from("creator_social_accounts").select("*").eq("creator_id", fx.creators[0].id))).toEqual(saved);
    const me = await request<Me>("/me"); expect(me.social_handles).toHaveLength(2);
    results.push("profile-unrelated-edit-preserves-canonical-and-legacy");
  });
  it("keeps Creator RLS and foreign-account actions scoped", async () => {
    const foreign = fx.must(await fx.service.from("creator_social_accounts").select("id").eq("creator_id", fx.creators[1].id).single());
    await request(`/social/accounts/${foreign!.id}/verification`, "POST", {}, 404);
    const other = fx.must(await fx.creators[0].client.from("creator_social_accounts").select("id").eq("creator_id", fx.creators[1].id));
    expect(other).toEqual([]);
    results.push("foreign-account-and-rls-denied");
  });
  it("persists resumable onboarding and awards exactly one existing welcome bonus under replay", async () => {
    const actor = fx.creators[1];
    fx.must(await fx.service.from("creators").update({ onboarding_completed: false, onboarding_step: 1 }).eq("id", actor.id));
    await request("/onboarding/profile", "PUT", { categories: ["美容"], step: 3 }, 200, actor);
    await request("/onboarding/profile", "PUT", { step: 2 }, 200, actor);
    const status = await request<{ onboarding_step: number }>("/onboarding/status", "GET", undefined, 200, actor);
    expect(status.onboarding_step).toBe(3);
    const baseline = await fx.neutrality(actor.id);
    const replies = await Promise.all(Array.from({ length: 4 }, () => request<{ onboarding_completed: boolean }>("/onboarding/complete", "POST", {}, 200, actor)));
    expect(replies.every(row => row.onboarding_completed)).toBe(true);
    const after = await fx.neutrality(actor.id);
    expect(after.points - baseline.points).toBe(100); expect(after.pointLedger - baseline.pointLedger).toBe(1);
    expect({ ...after, points: baseline.points, pointLedger: baseline.pointLedger }).toEqual(baseline);
    await request("/onboarding/complete", "POST", {}, 200, actor);
    expect(await fx.neutrality(actor.id)).toEqual(after);
    welcome = { before: baseline, after, existingWelcomeDelta: 100, existingWelcomeRows: 1, concurrentCalls: 4, replayUnchanged: true };
    results.push("onboarding-resume-and-unique-welcome");
  });
  it("uses non-enumerating errors for wrong and missing-account credentials", async () => {
    const wrong = await fresh.client.auth.signInWithPassword({ email: fx.creators[0].email, password: "not-the-fixture-password" });
    const absent = await fresh.client.auth.signInWithPassword({ email: `absent-${fx.runId}@example.test`, password: "not-the-fixture-password" });
    expect(wrong.error?.code).toBe("invalid_credentials"); expect(absent.error?.code).toBe(wrong.error?.code);
    results.push("real-auth-non-enumerating-errors");
  });
  it("consumes generated magic links once and rejects an expired owned recovery link", async () => {
    const actor = fx.creators[1];
    const link = fx.must(await fx.service.auth.admin.generateLink({ type: "magiclink", email: actor.email }));
    const hash = link.properties!.hashed_token; authSecrets.push(hash, link.properties!.action_link);
    expect((await actor.client.auth.verifyOtp({ token_hash: hash, type: "magiclink" })).error).toBeNull();
    expect((await actor.client.auth.verifyOtp({ token_hash: hash, type: "magiclink" })).error?.code).toBe("otp_expired");
    const expired = fx.must(await fx.service.auth.admin.generateLink({ type: "recovery", email: actor.email }));
    authSecrets.push(expired.properties!.hashed_token, expired.properties!.action_link);
    fx.target.sql(`begin; update auth.users set recovery_sent_at=now()-interval '2 days' where id='${actor.id}'; commit;`);
    expect((await actor.client.auth.verifyOtp({ token_hash: expired.properties!.hashed_token, type: "recovery" })).error?.code).toBe("otp_expired");
    results.push("real-auth-single-use-and-expiry");
  });
  it("resets a password with a real local recovery session without sending mail", async () => {
    const actor = fx.creators[1];
    const oldSession = actor.session;
    const link = fx.must(await fx.service.auth.admin.generateLink({ type: "recovery", email: actor.email }));
    authSecrets.push(link.properties!.hashed_token, link.properties!.action_link);
    const recovered = fx.must(await actor.client.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "recovery" }));
    expect(recovered.session).toBeTruthy();
    const password = `Recovered-${randomUUID()}!`;
    expect((await actor.client.auth.updateUser({ password })).error).toBeNull();
    expect((await actor.client.auth.signInWithPassword({ email: actor.email, password: actor.password })).error?.code).toBe("invalid_credentials");
    const signed = fx.must(await actor.client.auth.signInWithPassword({ email: actor.email, password }));
    const oldAccess = await actor.client.auth.getUser(oldSession.access_token);
    const oldRefresh = await actor.client.auth.refreshSession({ refresh_token: oldSession.refresh_token });
    const claims = JSON.parse(Buffer.from(oldSession.access_token.split(".")[1], "base64url").toString("utf8")) as { iat: number; exp: number };
    sessionPolicy = { oldAccessAccepted: !oldAccess.error, oldRefreshAccepted: !oldRefresh.error, jwtLifetimeSeconds: claims.exp - claims.iat,
      scope: "observed existing local Auth policy; no production policy or expiry changed" };
    actor.password = password; actor.jwt = signed.session!.access_token; actor.session = signed.session!; recoverySession = signed.session!;
    results.push("real-recovery-password-updated");
  });
  it("persists owned avatar and portfolio media and shares only approved public fields", async () => {
    const upload = await request<{ bucket: string; path: string; publicUrl: string }>("/me/profile-media/avatar-upload", "POST", { fileName: "identity.png", contentType: "image/png", sizeBytes: 68 });
    avatarPath = upload.path;
    expect(upload.path.startsWith(`${fx.creators[0].id}/`)).toBe(true);
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=", "base64");
    fx.must(await fx.service.storage.from(upload.bucket).upload(upload.path, pixel, { contentType: "image/png" }));
    await request("/me/profile-media/avatar-select", "POST", { storagePath: upload.path });
    for (const approved of [false, true]) {
      const result = await request<{ link: { id: string } }>("/me/profile-media/portfolio", "POST", { url: `https://example.test/${approved ? "approved" : "private"}-${fx.runId}`, title: approved ? "Approved synthetic highlight" : "Private synthetic portfolio", platform_type: "website", public_highlight: approved });
      mediaIds.push(result.link.id);
    }
    await request("/me/profile-media/publish", "POST", {});
    const share = await request<{ token: string; publicUrl: string }>("/me/passport/share", "POST", {});
    authSecrets.push(share.token, share.publicUrl);
    const res = await app.request(`/api/public/passports/${share.token}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { creator: Record<string,unknown>; profileMedia: { highlights: Array<{ title: string }> } };
    expect(Object.keys(data.creator).sort()).toEqual(["avatarUrl", "displayName", "level", "xp"]);
    expect(data.profileMedia.highlights.map(row => row.title)).toEqual(["Approved synthetic highlight"]);
    for (const forbidden of [fx.creators[0].email, "social_handles", "verification_code", "signedUrl", "private_identity", canonicalHandle]) expect(JSON.stringify(data)).not.toContain(forbidden);
    const me = await request<Me>("/me"); expect(me.avatar_url).toBe(upload.publicUrl);
    await request("/me/passport/share", "DELETE");
    expect((await app.request(`/api/public/passports/${share.token}`)).status).toBe(404);
    results.push("owned-media-public-minimization-and-revoke");
  }, 30000);
});
