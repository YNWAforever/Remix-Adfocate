// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadAssistantProgress, recordAssistantProgress } from "../lib/assistant/progress";

type Row = Record<string, unknown>;
function store(rows: Row[] = [], failInsert = false) {
  const inserts: Row[] = [];
  const from = () => {
    const filters: Row = {};
    const q: Record<string, unknown> = {
      insert(value: Row) { inserts.push(value); return Promise.resolve(failInsert ? { error: { message: "boom" } } : { error: null }); },
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      then(resolve: (value: unknown) => unknown) {
        const data = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { client: { from } as unknown as Parameters<typeof recordAssistantProgress>[0], inserts };
}

describe("assistant progress", () => {
  it("records bounded, owner-scoped progress steps", async () => {
    const fake = store();
    await recordAssistantProgress(fake.client, { requestId: "r".repeat(300), creatorId: "c1", workspaceId: "w1", step: "tool:" + "x".repeat(300) });
    expect(fake.inserts[0].request_id).toHaveLength(120);
    expect(fake.inserts[0].step).toHaveLength(160);
    expect(fake.inserts[0]).toMatchObject({ creator_id: "c1", workspace_id: "w1" });
  });

  it("never throws when the optional table is missing", async () => {
    await expect(recordAssistantProgress(store([], true).client, { requestId: "r", creatorId: "c", workspaceId: "w", step: "thinking" })).resolves.toBeUndefined();
  });

  it("loads only the caller's steps in order", async () => {
    const fake = store([
      { request_id: "r1", creator_id: "c1", workspace_id: "w1", step: "thinking", created_at: "2026-01-01T00:00:00Z" },
      { request_id: "r1", creator_id: "c1", workspace_id: "w1", step: "answering", created_at: "2026-01-01T00:00:01Z" },
      { request_id: "r1", creator_id: "other", workspace_id: "w1", step: "thinking", created_at: "2026-01-01T00:00:02Z" },
    ]);
    const steps = await loadAssistantProgress(fake.client, "r1", "c1", "w1");
    expect(steps.map(step => step.step)).toEqual(["thinking", "answering"]);
  });
});
