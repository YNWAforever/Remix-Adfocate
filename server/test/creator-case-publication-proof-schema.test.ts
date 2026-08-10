import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260810150000_creator_case_publication_proof_review.sql",
);

describe("Creator Case publication-proof review migration", () => {
  it("defines one service-role atomic operator command with immutable correction lineage", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("creator_case_review_publication_proof");
    expect(sql).toContain("creator_case_command_receipts");
    expect(sql).toContain("mission_publication_proof_decisions");
    expect(sql).toContain("mission_publication_proof_events");
    expect(sql).toContain("mission_workflow_events");
    expect(sql).toContain("for update");
    expect(sql).toContain("state = 'verified'");
    expect(sql).toContain("state = 'changes_requested'");
    expect(sql).toContain("parent_attempt_id");
    expect(sql).toContain("refresh_creator_studio_state");
    expect(sql).toContain("revoke all on function public.creator_case_review_publication_proof");
    expect(sql).toContain("grant execute on function public.creator_case_review_publication_proof");
  });
});
