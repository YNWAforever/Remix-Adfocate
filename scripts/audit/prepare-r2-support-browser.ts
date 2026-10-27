import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAuditFixture } from "../../server/test/auditWorkflowFixture.js";

// Existing factory verifies exact container/project/network identity before SDK or setup.
const fx = await createAuditFixture();
const ownedTrackIds: string[] = [];
const evidence = () => writeFileSync("docs/verification/R2-ui-fixture.json", JSON.stringify({
  runId: fx.runId, target: fx.target.identity, workspaceIds: [fx.workspaceId, fx.otherWorkspaceId],
  authIds: [...fx.creators.map(c => c.id), fx.operator.id, fx.noMembership.id], ownedTrackIds,
  cleanup: "none; exact new IDs retained, including incomplete attempts", content: "Synthetic parent metadata/eligibility fixtures only; no lesson units or approved curriculum",
}, null, 2) + "\n");
evidence();
for (const [workspace, role] of [[fx.workspaceId, "workspace_admin"], [null, "content_editor"]] as const) {
  if (![fx.operator.id, ...(workspace ? [workspace] : [])].every(id => /^[a-f0-9-]{36}$/.test(id))) throw new Error("Invalid exact owned grant IDs");
  fx.target.sql(`select private.bootstrap_staff_access('${fx.operator.id}',${workspace ? `'${workspace}'` : "null"},'${fx.operator.id}','${role}',true,0,'${randomUUID()}','Synthetic R2 owned fixture setup','Existing local disposable authorization / R2-${fx.runId}');`);
}
const { createApp } = await import("../../server/app.js");
const app = createApp().app;
async function request(path: string, actor = fx.operator, method = "GET", body?: unknown) {
  const response = await app.request(`/api${path}`, { method, headers: { Authorization: `Bearer ${actor.jwt}`, "X-Workspace-Slug": fx.slug, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Owned R2 setup ${method} ${path}: ${response.status}`);
  return response.json();
}
const metadata = { duration: { zh: "10 分鐘", en: "10 minutes" }, levelLabel: { zh: "合成入門", en: "Synthetic introduction" },
  futureExtension: { nested: ["retain", { version: 1 }] }, learningEnabled: false };
const tracks = [];
for (const [index, requiredLevel] of ["L0", "L0", "L3"].entries()) {
  const { item } = await request("/admin/academy", fx.operator, "POST", {
    kind: "track", slug: `r2-${fx.runId}-${index}`, title_zh: `合成 R2 課程資料 ${index}`, title_en: `Synthetic R2 parent ${index}`,
    body_zh: "", body_en: "", required_level: requiredLevel, metadata,
  });
  ownedTrackIds.push(item.id); evidence();
  tracks.push(index === 0 ? item : (await request(`/admin/academy/${item.id}/publish`, fx.operator, "POST", {})).item);
}
const reads = {
  history: await request("/redemption/history", fx.creators[0]),
  campaigns: await request("/campaigns", fx.creators[0]),
  applications: await request("/admin/applications"),
  adminCampaigns: await request("/admin/campaigns"),
  content: await request("/admin/content"),
};
const before = await Promise.all(fx.creators.map(c => fx.neutrality(c.id)));
writeFileSync(".codex-tmp/R2-ui-fixture.private.json", JSON.stringify({
  runId: fx.runId, target: fx.target.identity, workspaceId: fx.workspaceId, slug: fx.slug,
  creator: fx.creators[0], other: fx.creators[1], operator: fx.operator, tracks, before,
  emptyReadCounts: { history: reads.history.redemptions.length, campaigns: reads.campaigns.campaigns.length,
    applications: reads.applications.applications.length, adminCampaigns: reads.adminCampaigns.campaigns.length, content: reads.content.items.length },
}, (key,value) => key === "client" ? undefined : value));
console.log("R2 exact-owned fixture ready; no cleanup, real content or providers.");
