import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitMissionForMode } from "../routes/missions";

describe("legacy evidence format at the server boundary (offline)", () => {
  it.each([[], ["wwww"], ["/relative"], ["javascript:alert(1)"], ["https://name:secret@example.test/a"], ["https://example.test/a", "bad"],
    ["https://example.test:/work"], ["https://example.test:000080/work"], ["https://@example.test/work"]])(
    "rejects invalid or mixed evidence before the RPC: %j", async (...values) => {
      const urls = values as unknown as string[];
      const rpc = vi.fn(async () => ({ data: {}, error: null }));
      const result = await submitMissionForMode({ rpc } as unknown as SupabaseClient,
        { id: "mission", creator_workflow_mode: "legacy" }, { content_urls: urls });
      expect(result.error).toMatchObject({ message: "invalid_evidence" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("submits a trimmed, deduplicated valid set without losing all-or-nothing validation", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "submission" }, error: null }));
    await submitMissionForMode({ rpc } as unknown as SupabaseClient,
      { id: "mission", creator_workflow_mode: "legacy" }, { content_urls: [" https://example.test/work ", "https://example.test/work"] });
    expect(rpc).toHaveBeenCalledWith("submit_mission", { p_mission: "mission", p_urls: ["https://example.test/work"], p_data: {} });
  });
});
