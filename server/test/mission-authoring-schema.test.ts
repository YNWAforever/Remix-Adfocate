// server/test/mission-authoring-schema.test.ts
import { describe, it, expect } from "vitest";
import { serviceForTests, hasSupabaseEnv, DEMO_WS } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("0018 mission authoring schema", () => {
  it("rejects an out-of-set status via the CHECK constraint", async () => {
    const { error } = await serviceForTests()
      .from("missions")
      .insert({ workspace_id: DEMO_WS, slug: "test-bad-status", title: "x", mission_type: "ugc", status: "archived" });
    expect(error).toBeTruthy();
    expect(error?.message.toLowerCase()).toContain("missions_status_chk");
  });

  it("accepts a draft and exposes the new authoring columns", async () => {
    const svc = serviceForTests();
    const { data, error } = await svc
      .from("missions")
      .insert({ workspace_id: DEMO_WS, slug: "test-schema-draft", title: "x", mission_type: "ugc", status: "draft" })
      .select("id, status, updated_at, published_at, closed_at, created_by, deliverable_specs")
      .single();
    expect(error).toBeFalsy();
    expect(data?.status).toBe("draft");
    expect(data?.updated_at).toBeTruthy();
    expect(data?.published_at).toBeNull();
    expect(data?.created_by).toBeNull();
    expect(data?.deliverable_specs).toEqual([]);
    await svc.from("missions").delete().eq("id", data!.id);
  });
});
