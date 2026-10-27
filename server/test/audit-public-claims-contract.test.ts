import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createAuditFixture } from "./auditWorkflowFixture";

describe.skipIf(process.env.RUN_AUDIT_INTEGRATION !== "1")("D14 owned Academy authoring and availability", () => {
  let fx: Awaited<ReturnType<typeof createAuditFixture>>;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  let before: Awaited<ReturnType<Awaited<ReturnType<typeof createAuditFixture>>["neutrality"]>>;
  const rows: Record<string, Record<string, unknown>> = {};
  async function request(path: string, method = "GET", data?: unknown, status = 200, actor?: { jwt: string }) {
    const response = await app.request(`/api${path}`, { method, headers: {
      Authorization: `Bearer ${(actor ?? fx.operator).jwt}`, "X-Workspace-Slug": fx.slug, "Content-Type": "application/json",
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    return response.json();
  }
  beforeAll(async () => {
    // The fixture verifies container/project/proxy identity before importing the SDK or creating clients.
    fx = await (await import("./auditWorkflowFixture")).createAuditFixture();
    app = (await import("../app")).createApp().app;
    // Trust is derived by the existing server engine; it is not a writable creator column.
    fx.must(await fx.service.from("creators").update({ xp: 6000 }).eq("id", fx.creators[1].id).eq("workspace_id", fx.workspaceId));
    before = await fx.neutrality(fx.creators[0].id);
    for (const [key, kind, body, required] of [
      ["resource", "resource", "## 合成資源正文\n\n可閱讀的完整測試內容。", null],
      ["ready", "track", "## 合成課程正文\n\nThis is owned reading content, not four lesson units.", "L0"],
      ["empty", "track", "", "L0"], ["gated", "track", "## Gated reading body", "L2"],
    ] as const) {
      rows[key] = (await request("/admin/academy", "POST", { kind, slug: `d14-${key}-${fx.runId}`,
        title_zh: `D14 ${key} ${fx.runId}`, title_en: `D14 ${key} ${fx.runId}`, excerpt_zh: "合成課程簡介，並非四個課堂。",
        excerpt_en: "Owned introduction, not four lessons.", body_zh: body, body_en: body, required_level: required,
        metadata: { duration: { en: "4 lessons", zh: "4堂課" }, levelLabel: required ?? "" } }, 201)).item;
    }
  }, 60000);
  afterAll(async () => {
    if (!fx || !before) return;
    const after = await fx.neutrality(fx.creators[0].id);
    expect(after).toEqual(before);
    writeFileSync(".codex-tmp/D14-fixture.private.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity,
      workspaceId: fx.workspaceId, slug: fx.slug, creator: fx.creators[0], untrusted: fx.creators[1], operator: fx.operator, rows },
    (key, value) => key === "client" ? undefined : value));
    writeFileSync("docs/verification/D14-api-contract.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity,
      ownedContent: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, { id: value.id, slug: value.slug }])),
      neutrality: { before, after, allEqual: JSON.stringify(before) === JSON.stringify(after) },
      cleanup: "retained exact owned IDs; no delete, reset, seed or production access", providers: "external HTTP blocked" }, null, 2) + "\n");
    fx.recordEvidence({ caseId: "D14-public-claims", ownedContentIds: Object.values(rows).map(row => row.id), before, after });
  });
  it("creates and reloads a resource with title, excerpt and a real body, while its draft remains private", async () => {
    const item = (await request(`/admin/academy/${rows.resource.id}`)).item;
    expect(item).toMatchObject({ kind: "resource", body_zh: rows.resource.body_zh, excerpt_zh: rows.resource.excerpt_zh });
    const bundle = await request("/academy", "GET", undefined, 200, fx.creators[0]);
    expect(bundle.resources.some((row: { id: string }) => row.id === item.id)).toBe(false);
  });
  it("publishes persisted resource content and retains it on a fresh author read", async () => {
    await request(`/admin/academy/${rows.resource.id}/publish`, "POST", {});
    const item = (await request(`/admin/academy/${rows.resource.id}`)).item;
    expect(item).toMatchObject({ status: "published", body_zh: rows.resource.body_zh });
    expect(item.published_at).toBeTruthy();
  });
  it("publishes reading content and derives localized availability without exposing the body in the bundle", async () => {
    await request(`/admin/academy/${rows.ready.id}/publish`, "POST", {});
    for (const lang of ["en", "zh-HK"]) {
      const bundle = await request(`/academy?lang=${lang}`, "GET", undefined, 200, fx.creators[0]);
      const listed = bundle.tracks.find((row: { id: string }) => row.id === rows.ready.id);
      expect(listed.contentStatus).toBe("available"); expect(listed.body).toBeUndefined();
      const { item } = await request(`/academy/track/${rows.ready.slug}?lang=${lang}`, "GET", undefined, 200, fx.creators[0]);
      expect(item.body).toBe(rows.ready.body_zh); expect(item.contentStatus).toBe("available");
    }
  });
  it("empty published tracks stay preparing despite a four-lesson duration; no lesson/progress data is invented", async () => {
    for (const key of ["empty", "gated"]) await request(`/admin/academy/${rows[key].id}/publish`, "POST", {});
    const { item } = await request(`/academy/track/${rows.empty.slug}`, "GET", undefined, 200, fx.creators[0]);
    expect(item).toMatchObject({ body: "", contentStatus: "preparing" });
    expect(item.lessons).toBeUndefined(); expect(item.progress).toBeUndefined();
  });
  it("filters track author rows independently from resources and creator bundle groups", async () => {
    const { items } = await request("/admin/academy?kind=track");
    expect(items.every((row: { kind: string }) => row.kind === "track")).toBe(true);
    expect(items.some((row: { id: string }) => row.id === rows.resource.id)).toBe(false);
    const bundle = await request("/academy", "GET", undefined, 200, fx.creators[0]);
    expect(bundle.resources.some((row: { id: string }) => row.id === rows.resource.id)).toBe(true);
    expect(bundle.tracks.some((row: { id: string }) => row.id === rows.resource.id)).toBe(false);
  });
  it("retains author revisions, rejects stale updates and denies creator authoring", async () => {
    const item = (await request(`/admin/academy/${rows.ready.id}`)).item;
    await request(`/admin/academy/${item.id}`, "PATCH", { body_en: `${item.body_en}\n\nRevision two.`, updated_at: item.updated_at });
    await request(`/admin/academy/${item.id}`, "PATCH", { title_en: "must not persist", updated_at: item.updated_at }, 409);
    expect((await request(`/admin/academy/${item.id}`)).item.title_en).toBe(item.title_en);
    await request(`/admin/academy/${item.id}`, "PATCH", { body_en: "forbidden" }, 403, fx.creators[0]);
  });
});
