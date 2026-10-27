import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createAuditFixture } from "./auditWorkflowFixture";

describe.skipIf(process.env.RUN_AUDIT_INTEGRATION !== "1")("D15 owned Academy learning", () => {
  let fx: Awaited<ReturnType<typeof createAuditFixture>>;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  let before: Awaited<ReturnType<Awaited<ReturnType<typeof createAuditFixture>>["neutrality"]>>;
  let track: { id: string; slug: string }, locked: typeof track, browserTrack: typeof track;
  let otherBefore: typeof before;
  let firstCompletion: string;
  const lessons: Record<string, unknown>[] = [];
  async function request(path: string, method = "GET", data?: unknown, status = 200, actor?: { jwt: string }) {
    const response = await app.request(`/api${path}`, { method, headers: {
      Authorization: `Bearer ${(actor ?? fx.creators[0]).jwt}`, "X-Workspace-Slug": fx.slug, "Content-Type": "application/json",
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    return response.json();
  }
  beforeAll(async () => {
    fx = await (await import("./auditWorkflowFixture")).createAuditFixture();
    app = (await import("../app")).createApp().app;
    before = await fx.neutrality(fx.creators[0].id);
    fx.must(await fx.service.from("creators").update({ xp: 6000 }).eq("id", fx.creators[1].id).eq("workspace_id", fx.workspaceId));
    otherBefore = await fx.neutrality(fx.creators[1].id);
    for (const level of ["L0", "L2"]) {
      const id = randomUUID(), slug = `d15-${level}-${fx.runId}`;
      fx.must(await fx.service.from("academy_content").insert({ id, slug, kind: "track", status: "published", title_zh: `Synthetic learning ${level}`,
        required_level: level, body_zh: level === "L2" ? "Locked overview body" : "Owned course introduction", metadata: { duration: "4 lessons" } }));
      if (level === "L0") track = { id, slug }; else locked = { id, slug };
    }
    browserTrack = { id: randomUUID(), slug: `d15-browser-${fx.runId}` };
    fx.must(await fx.service.from("academy_content").insert({ ...browserTrack, kind: "track", status: "draft", title_zh: "Synthetic browser curriculum", required_level: "L0", body_zh: "Synthetic browser overview" }));
  }, 60000);
  afterAll(async () => {
    if (!fx || !before) return;
    const after = await fx.neutrality(fx.creators[0].id);
    const otherAfter = await fx.neutrality(fx.creators[1].id);
    expect(after).toEqual(before);
    expect(otherAfter).toEqual(otherBefore);
    writeFileSync(".codex-tmp/D15-fixture.private.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity, workspaceId: fx.workspaceId,
      slug: fx.slug, creator: fx.creators[0], other: fx.creators[1], operator: fx.operator, track, locked, browserTrack, lessons }, (key,value) => key === "client" ? undefined : value));
    writeFileSync("docs/verification/D15-api-contract.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity, track, locked,
      ownedLessonIds: lessons.map(row => row.id), neutrality: { before, after, allEqual: JSON.stringify(before) === JSON.stringify(after) },
      otherNeutrality: { before: otherBefore, after: otherAfter, allEqual: JSON.stringify(otherBefore) === JSON.stringify(otherAfter) }, browserTrack,
      content: "explicitly synthetic only; no real course or owner approval claimed", cleanup: "all exact IDs retained; no delete/reset" }, null, 2) + "\n");
    fx.recordEvidence({ caseId: "N03", track, locked, lessonIds: lessons.map(row => row.id), before, after });
  });
  it("lists actual published lessons and a saved-progress total, never infers four lessons from metadata", async () => {
    const value = await request(`/academy/track/${track.slug}/lessons`);
    expect(value.lessons).toEqual([]); expect(value.progress).toMatchObject({ completed: 0, total: 0 });
  });
  it("lets the existing operator create and reload a lesson draft with real fixture body", async () => {
    const { item } = await request(`/admin/academy/${track.id}/lessons`, "POST", { title_zh: "Synthetic first unit", body_zh: "## Fixture unit one\n\nRead the owned acceptance material.", position: 0 }, 201, fx.operator);
    lessons.push(item);
    const { items } = await request(`/admin/academy/${track.id}/lessons`, "GET", undefined, 200, fx.operator);
    expect(items.find((row: { id: string }) => row.id === item.id)).toMatchObject({ status: "draft", body_zh: "## Fixture unit one\n\nRead the owned acceptance material." });
  });
  it("withholds locked overview bodies and rejects locked lesson reads at the API boundary", async () => {
    const { item } = await request(`/academy/track/${locked.slug}`);
    expect(item.body).toBe("");
    await request(`/academy/track/${locked.slug}/lessons`, "GET", undefined, 403);
  });
  it("never shows draft lessons to a Creator, including direct RLS reads and completion", async () => {
    expect((await request(`/academy/track/${track.slug}/lessons`)).lessons).toEqual([]);
    const direct = fx.must(await fx.creators[0].client.from("academy_lessons").select("*").eq("track_id", track.id));
    expect(direct).toEqual([]);
    await request(`/academy/track/${track.slug}/lessons/${lessons[0].id}/complete`, "POST", { contentVersion: 1 }, 409);
  });
  it("requires real body and explicit approval reference; publishes two synthetic units with an idempotent publish replay", async () => {
    const second = (await request(`/admin/academy/${track.id}/lessons`, "POST", { title_zh: "Synthetic second unit", body_zh: "## Fixture unit two\n\nOwned second reading.", position: 1 }, 201, fx.operator)).item;
    lessons.push(second);
    const invalid = (await request(`/admin/academy/${track.id}/lessons`, "POST", { title_zh: "Empty draft", body_zh: "", position: 2 }, 201, fx.operator)).item;
    lessons.push(invalid);
    const command = (row: Record<string, unknown>) => ({ contentVersion: row.content_version, revision: row.revision, approvalRef: `SYNTHETIC ONLY/${fx.runId}` });
    await request(`/admin/academy/${track.id}/lessons/${lessons[0].id}/publish`, "POST", { ...command(lessons[0]), approvalRef: "" }, 422, fx.operator);
    await request(`/admin/academy/${track.id}/lessons/${invalid.id}/publish`, "POST", command(invalid), 422, fx.operator);
    for (let i = 0; i < 2; i++) {
      const row = lessons[i], input = command(row);
      const first = (await request(`/admin/academy/${track.id}/lessons/${row.id}/publish`, "POST", input, 200, fx.operator)).item;
      const replay = (await request(`/admin/academy/${track.id}/lessons/${row.id}/publish`, "POST", input, 200, fx.operator)).item;
      expect(replay).toEqual(first); lessons[i] = first;
    }
    const value = await request(`/academy/track/${track.slug}/lessons`);
    expect(value.progress).toEqual({ completed: 0, total: 2 });
    expect(value.lessons.map((row: { position: number }) => row.position)).toEqual([0, 1]);
    expect(value.lessons.some((row: { id: string }) => row.id === invalid.id)).toBe(false);
  });
  it("four concurrent completion requests and replay create one durable completion; refresh reads 1/2", async () => {
    const path = `/academy/track/${track.slug}/lessons/${lessons[0].id}/complete`;
    const results = await Promise.all(Array.from({ length: 4 }, () => request(path, "POST", { contentVersion: 1 })));
    firstCompletion = results[0].completedAt;
    expect(new Set(results.map(row => row.completedAt)).size).toBe(1);
    expect((await request(path, "POST", { contentVersion: 1 })).completedAt).toBe(firstCompletion);
    expect((await request(`/academy/track/${track.slug}/lessons`)).progress).toEqual({ completed: 1, total: 2 });
    const saved = fx.must(await fx.service.from("creator_lesson_progress").select("*").eq("creator_id", fx.creators[0].id).eq("lesson_id", lessons[0].id));
    expect(saved).toHaveLength(1);
  });
  it("the other Creator has 0/2 and cannot read or forge the first Creator's progress", async () => {
    const value = await request(`/academy/track/${track.slug}/lessons`, "GET", undefined, 200, fx.creators[1]);
    expect(value.progress).toEqual({ completed: 0, total: 2 }); expect(value.history).toEqual([]);
    expect(fx.must(await fx.creators[1].client.from("creator_lesson_progress").select("*").eq("creator_id", fx.creators[0].id))).toEqual([]);
    const forged = await fx.creators[1].client.from("creator_lesson_progress").insert({ creator_id: fx.creators[0].id, lesson_id: lessons[0].id, content_version: 1 });
    expect(forged.error).toBeTruthy();
    await request(`/academy/track/${track.slug}/lessons?creatorId=${fx.creators[0].id}`, "GET", undefined, 403, fx.creators[1]);
    await request(`/academy/track/${track.slug}/lessons/${lessons[0].id}/complete`, "POST", { contentVersion: 1, creatorId: fx.creators[0].id }, 403, fx.creators[1]);
  });
  it("raw XP without owner verification stays locked through API and direct lesson RLS", async () => {
    let row = (await request(`/admin/academy/${locked.id}/lessons`, "POST", { title_zh: "Locked fixture", body_zh: "Locked unit body", position: 0 }, 201, fx.operator)).item;
    row = (await request(`/admin/academy/${locked.id}/lessons/${row.id}/publish`, "POST", { contentVersion: 1, revision: row.revision, approvalRef: `SYNTHETIC ONLY/${fx.runId}` }, 200, fx.operator)).item;
    lessons.push(row);
    await request(`/academy/track/${locked.slug}/lessons`, "GET", undefined, 403, fx.creators[1]);
    expect(fx.must(await fx.creators[1].client.from("academy_lessons").select("body_zh").eq("track_id", locked.id))).toEqual([]);
    fx.must(await fx.service.from("creator_social_accounts").insert({ workspace_id: fx.workspaceId, creator_id: fx.creators[1].id, platform: "instagram", handle: `d15_${fx.runId.replaceAll("-", "")}`, owner_verified: true }));
    const trusted = await request(`/academy/track/${locked.slug}/lessons`, "GET", undefined, 200, fx.creators[1]);
    expect(trusted.lessons[0].body).toBe("Locked unit body");
  });
  it("new content remains a draft while the published version and its progress stay unchanged", async () => {
    const first = lessons[0];
    const draft = (await request(`/admin/academy/${track.id}/lessons/${first.id}`, "PATCH", { contentVersion: first.content_version, revision: first.revision, body_zh: "## Revised fixture unit one", position: 5 }, 200, fx.operator)).item;
    expect(draft.content_version).toBe(2); expect(draft.status).toBe("draft"); expect(draft.approval_ref).toBeNull();
    lessons.push(draft);
    const value = await request(`/academy/track/${track.slug}/lessons`);
    expect(value.lessons.find((row: { id: string }) => row.id === first.id).contentVersion).toBe(1);
    expect(value.progress).toEqual({ completed: 1, total: 2 });
  });
  it("publishing v2 preserves the old completion timestamp and counts only current versions", async () => {
    const draft = lessons.find(row => row.id === lessons[0].id && row.content_version === 2)!;
    const published = (await request(`/admin/academy/${track.id}/lessons/${draft.id}/publish`, "POST", { contentVersion: 2, revision: draft.revision, approvalRef: `SYNTHETIC v2 ONLY/${fx.runId}` }, 200, fx.operator)).item;
    lessons[0] = published;
    let value = await request(`/academy/track/${track.slug}/lessons`);
    expect(value.progress).toEqual({ completed: 0, total: 2 });
    expect(value.history).toContainEqual({ lessonId: published.id, contentVersion: 1, completedAt: firstCompletion });
    expect(value.lessons.map((row: { position: number }) => row.position)).toEqual([1, 5]);
    await request(`/academy/track/${track.slug}/lessons/${published.id}/complete`, "POST", { contentVersion: 1 }, 409);
    await request(`/academy/track/${track.slug}/lessons/${published.id}/complete`, "POST", { contentVersion: 2 });
    value = await request(`/academy/track/${track.slug}/lessons`);
    expect(value.progress).toEqual({ completed: 1, total: 2 }); expect(value.history).toHaveLength(2);
  });
  it("rejects stale author revisions and Creator writes without overwriting content", async () => {
    const row = lessons[0];
    await request(`/admin/academy/${track.id}/lessons/${row.id}`, "PATCH", { contentVersion: row.content_version, revision: -1, body_zh: "invalid" }, 422, fx.operator);
    await request(`/admin/academy/${track.id}/lessons/${row.id}`, "PATCH", { contentVersion: row.content_version, revision: Number(row.revision) - 1, body_zh: "stale overwrite" }, 409, fx.operator);
    await request(`/admin/academy/${track.id}/lessons`, "POST", { title_zh: "forbidden" }, 403, fx.creators[0]);
    expect((await request(`/academy/track/${track.slug}/lessons`)).lessons.some((row: { body: string }) => row.body === "stale overwrite")).toBe(false);
  });
  it("published lesson snapshots under a draft parent stay hidden from Creators", async () => {
    const row = (await request(`/admin/academy/${browserTrack.id}/lessons`, "POST", { title_zh: "Synthetic draft-parent unit", body_zh: "Never visible from a draft course", position: 100 }, 201, fx.operator)).item;
    lessons.push(row);
    await request(`/admin/academy/${browserTrack.id}/lessons/${row.id}/publish`, "POST", { contentVersion: 1, revision: row.revision, approvalRef: `SYNTHETIC hidden ONLY/${fx.runId}` }, 200, fx.operator);
    await request(`/academy/track/${browserTrack.slug}/lessons`, "GET", undefined, 404);
    expect(fx.must(await fx.creators[0].client.from("academy_lessons").select("*").eq("track_id", browserTrack.id))).toEqual([]);
    // Retain the hidden snapshot but archive it before the separate browser two-unit fixture is published.
    const current = (await request(`/admin/academy/${browserTrack.id}/lessons`, "GET", undefined, 200, fx.operator)).items[0];
    await request(`/admin/academy/${browserTrack.id}/lessons/${row.id}/archive`, "POST", { contentVersion: 1, revision: current.revision }, 200, fx.operator);
  });
});
