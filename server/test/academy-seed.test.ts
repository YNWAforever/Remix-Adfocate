import { describe, it, expect } from "vitest";
import { serviceForTests, hasSupabaseEnv } from "./helpers.js";
import { LEVEL_IDS } from "../lib/academyAuthoring.js";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("academy_content seed integrity", () => {
  it("has the expected published row counts", async () => {
    const svc = serviceForTests();
    const counts: Record<string, number> = {};
    for (const kind of ["guide_doc", "track", "playbook", "resource"]) {
      const { count } = await svc.from("academy_content").select("id", { count: "exact", head: true })
        .eq("kind", kind).eq("status", "published");
      counts[kind] = count ?? 0;
    }
    expect(counts).toEqual({ guide_doc: 8, track: 9, playbook: 6, resource: 8 });
  });

  it("no guide_doc body_zh contains a leading frontmatter fence", async () => {
    const { data } = await serviceForTests().from("academy_content").select("slug, body_zh").eq("kind", "guide_doc");
    for (const row of data ?? []) expect((row.body_zh as string).trimStart().startsWith("---")).toBe(false);
  });

  it("every track required_level is a canonical LEVELS id", async () => {
    const { data } = await serviceForTests().from("academy_content").select("slug, required_level").eq("kind", "track");
    for (const row of data ?? []) expect(LEVEL_IDS).toContain(row.required_level);
  });
});
