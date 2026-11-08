// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { answerFingerprint, readToolTraces, saveToolTrace } from "../lib/studio/toolTraces";

type Call = { table: string; op: string; value?: unknown };
function store(rows: unknown, options: { fail?: boolean } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {
      select(fields: string) { calls.push({ table, op: "select:" + fields }); return query; },
      eq() { return query; },
      order() { return query; },
      limit() { return query; },
      upsert(value: unknown) { calls.push({ table, op: "upsert", value }); return query; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: options.fail ? null : rows, error: options.fail ? { code: "42P01", message: "relation does not exist" } : null }).then(resolve);
      },
    };
    return query;
  };
  return { client: { from } as unknown as Parameters<typeof saveToolTrace>[0], calls };
}

describe("studio tool traces", () => {
  it("fingerprints answers deterministically", () => {
    expect(answerFingerprint("same answer")).toBe(answerFingerprint("same answer"));
    expect(answerFingerprint("same answer")).toMatch(/^[0-9a-f]{64}$/);
    expect(answerFingerprint("same answer")).not.toBe(answerFingerprint("other answer"));
  });
  it("persists a trace with the conversation, answer hash and tool names", async () => {
    const fake = store([], {});
    await saveToolTrace(fake.client, "conversation", "The answer", ["get_open_missions"], "request-1");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: "assistant_tool_traces", op: "upsert" });
    expect(fake.calls[0].value).toMatchObject({
      request_id: "request-1",
      conversation_id: "conversation",
      answer_hash: answerFingerprint("The answer"),
      tools: ["get_open_missions"],
    });
  });
  it("skips empty traces and never throws when the table is missing", async () => {
    const skipped = store([], {});
    await saveToolTrace(skipped.client, "conversation", "answer", undefined, "request-1");
    await saveToolTrace(skipped.client, null, "answer", ["get_my_points"], "request-2");
    expect(skipped.calls).toHaveLength(0);
    const failing = store(null, { fail: true });
    await expect(saveToolTrace(failing.client, "conversation", "answer", ["get_my_points"], "request-3")).resolves.toBeUndefined();
  });
  it("maps persisted traces by answer hash and ignores malformed rows", async () => {
    const fake = store([
      { answer_hash: answerFingerprint("kept"), tools: ["get_my_points", 7] },
      { answer_hash: 42, tools: ["get_my_missions"] },
      { answer_hash: answerFingerprint("no tools"), tools: "nope" },
    ]);
    const traces = await readToolTraces(fake.client, "conversation");
    expect(traces.get(answerFingerprint("kept"))).toEqual(["get_my_points"]);
    expect(traces.size).toBe(1);
  });
  it("returns no traces when the migration has not been applied", async () => {
    const fake = store(null, { fail: true });
    await expect(readToolTraces(fake.client, "conversation")).resolves.toEqual(new Map());
  });
});
