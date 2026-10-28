import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], selects: [] as string[], subscriptionError: false }));
// This transport fake honors the real SELECT projection. Returning whole fixture
// objects here would hide precisely the missing-list-fields regression.
vi.mock("../lib/supabase", () => ({ makeUserClient: () => ({ from(table: string) {
  let columns = "*";
  const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
  function result() {
    const source = table === "missions" ? state.rows : [];
    const data = source.filter((row) => predicates.every((predicate) => predicate(row))).map((row) => {
      if (columns.includes("*")) return { ...row };
      const projected: Record<string, unknown> = {};
      for (const column of columns.split(/,(?![^()]*\))/).map((value) => value.trim())) {
        const name = column.split("(")[0];
        if (name in row) projected[name] = row[name];
      }
      return projected;
    });
    return { data, error: table === "mission_submissions" && state.subscriptionError ? { message: "status unavailable" } : null };
  }
  const query = {
    select(value: string) { columns = value; state.selects.push(`${table}:${value}`); return query; },
    eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return query; },
    in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return query; },
    order() { return query; },
    async maybeSingle() { const value = result(); return { ...value, data: value.data[0] ?? null }; },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return query;
} }) }));
import { missionRoutes } from "../routes/missions";

const app = new Hono<Env>().use("*", async (c, next) => {
  c.set("workspaceId", "workspace-a"); c.set("userId", "creator-a"); c.set("jwt", "unit-transport"); await next();
}).route("/missions", missionRoutes);
const rich = {
  id: "mission-a", workspace_id: "workspace-a", slug: "decision", title: "很長的中文任務標題保留完整資訊", description: "Synthetic decision brief",
  category: "寵物", mission_type: "ugc", access_type: "open", points_reward: 50, cash_reward: 125, required_level: "L2",
  platforms: ["instagram", "tiktok"], deliverables: ["一條長中文介紹短片"], requirements: ["Keep the disclosure"], effort: "medium",
  deadline: "2026-11-30", quota: 10, filled: 3, status: "active", workspaces: { name: "Synthetic brand" },
};
const decisions = ["cash_reward", "required_level", "platforms", "deliverables", "effort", "brand", "deadline", "quota", "filled", "points_reward", "access_type", "mission_type"];
describe("D09 serialized mission-list contract (projection-aware unit transport)", () => {
  beforeEach(() => { state.rows = [{ ...rich }]; state.selects = []; state.subscriptionError = false; });
  it("serializes the same backed decision fields as detail, including the joined brand", async () => {
    const list = await (await app.request("/missions")).json();
    const detail = await (await app.request("/missions/decision")).json();
    for (const key of decisions) expect(list.missions[0], key).toHaveProperty(key, detail[key]);
    expect(list.missions[0].brand).toBe("Synthetic brand");
    expect(list.missions[0]).not.toHaveProperty("workspaces");
  });
  it.each([0, null])("preserves cash=%s and null metadata without inventing defaults", async (cash) => {
    Object.assign(state.rows[0], { cash_reward: cash, required_level: null, platforms: null, deliverables: null, effort: null });
    const { missions } = await (await app.request("/missions")).json();
    expect(missions[0]).toMatchObject({ cash_reward: cash, required_level: null, platforms: null, deliverables: null, effort: null });
  });
  it("needs one mission-list read for many rows, with no per-row detail requests", async () => {
    state.rows.push({ ...rich, id: "second", slug: "second" });
    const { missions } = await (await app.request("/missions")).json();
    expect(missions).toHaveLength(2);
    expect(state.selects.filter((value) => value.startsWith("missions:"))).toHaveLength(1);
  });
  it("finds canonical and legacy travel values while retaining workspace/status scope", async () => {
    state.rows = [
      { ...rich, id: "canonical", category: "旅遊" }, { ...rich, id: "alias", category: "travel" },
      { ...rich, id: "foreign", category: "旅遊", workspace_id: "workspace-b" }, { ...rich, id: "draft", category: "旅遊", status: "draft" },
    ];
    const { missions } = await (await app.request("/missions?category=" + encodeURIComponent("旅遊"))).json();
    expect(missions.map((row: { id: string }) => row.id).sort()).toEqual(["alias", "canonical"]);
    expect(missions.map((row: { category: string }) => row.category).sort()).toEqual(["travel", "旅遊"].sort());
  });
  it.each(["其他既有分類與很長的中文分類說明", "TrAvEl"])("keeps unknown category %s findable verbatim", async (category) => {
    state.rows[0].category = category;
    const { missions } = await (await app.request(`/missions?category=${encodeURIComponent(category)}`)).json();
    expect(missions).toHaveLength(1);
    expect(missions[0].category).toBe(category);
  });
  it("does not announce no prior participation when the caller-status read fails", async () => {
    state.subscriptionError = true;
    const response = await app.request("/missions");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "db_error" });
  });
});
