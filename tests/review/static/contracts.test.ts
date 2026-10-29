// Static contract checks: no database needed, safe for CI. Each guards a deploy- or
// locale-level defect that unit tests running against the in-process app cannot see.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defect, knownBug } from "../support/bug";
import { formatCreatorCurrency, formatCreatorDate } from "../../../src/lib/creatorFormatting";

const read = (p: string) => readFileSync(p, "utf8");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);

describe("deployment contract", () => {
  knownBug("F-001", "the Vercel entry (api/index.ts) exports every HTTP method the Hono routes use", () => {
    const used = new Set<string>();
    for (const file of walk("server/routes").filter(f => f.endsWith(".ts") && !f.includes(".test."))) {
      for (const m of read(file).matchAll(/\.(get|post|put|patch|delete)\(\s*[`"']/g)) used.add(m[1].toUpperCase());
    }
    expect(used.has("PATCH")).toBe(true); // routes really use PATCH (draft autosave, admin edits)
    const exported = new Set([...read("api/index.ts").matchAll(/export const (GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)].map(m => m[1]));
    defect(() => expect([...used].filter(m => !exported.has(m))).toEqual([]));
  });

  it("every client PATCH call targets a server PATCH route (so F-001 affects real screens)", () => {
    const clientPatch = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))
      .filter(f => /method:\s*(?:existing \? )?"PATCH"/.test(read(f)));
    expect(clientPatch.length).toBeGreaterThanOrEqual(5);
  });
});

describe("notifications and settlement wiring", () => {
  knownBug("F-012", "the daily cron calls emit_active_mission_deadline_notifications", () => {
    const cron = read("server/routes/cron.ts");
    expect(cron).toContain("/daily");
    defect(() => expect(cron).toContain("emit_active_mission_deadline_notifications"));
  });

  knownBug("F-007", "wallet 'pending' includes active-mission pending reward hand-offs", () => {
    const wallet = read("server/routes/wallet.ts");
    expect(wallet).toContain("pending");
    defect(() => expect(wallet).toMatch(/mission_pending_rewards|reward_handoff/));
  });

  knownBug("F-007", "a migration settles mission_pending_rewards into a ledger (pending → settled)", () => {
    const sql = walk("supabase/migrations").map(read).join("\n");
    expect(sql).toContain("mission_pending_rewards");
    defect(() => expect(sql).toMatch(/'settled'[\s\S]{0,400}mission_pending_rewards|mission_pending_rewards[\s\S]{0,400}'settled'/));
  });

  knownBug("F-038", "accepting an application captures a reward contract in the same transaction", () => {
    const decide = read("supabase/migrations/20261025120934_application_decisions.sql");
    expect(decide).toContain("create_mission_workflow");
    defect(() => expect(decide).toMatch(/mission_reward_contracts|capture_.*contract/));
  });
});

describe("Hong Kong locale: dates and currency", () => {
  it("the shared creator formatter renders HKT dates and HKD currency", () => {
    // 2026-10-28T16:30Z is 29 Oct 00:30 in Hong Kong — the UTC calendar day would be the 28th.
    expect(formatCreatorDate("2026-10-28T16:30:00Z", "en")).toMatch(/29/);
    expect(formatCreatorDate("2026-10-28T16:30:00Z", "zh")).toMatch(/29/);
    expect(formatCreatorCurrency(1234.5, "en")).toMatch(/HK\$|HKD/);
  });

  knownBug("F-020", "creator-facing components never format deadlines in UTC or by slicing ISO strings", () => {
    const offenders = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes(".test.") && !f.includes("/admin/"))
      .filter(f => /timeZone:\s*["']UTC["']|toISOString\(\)\.slice\(0,\s*10\)|\.slice\(0,\s*10\)/.test(read(f)));
    defect(() => expect(offenders).toEqual([]));
  });
});

describe("copy honesty", () => {
  knownBug("F-006", "no copy promises withdrawable cash while no payout flow exists", () => {
    const hasPayoutRoute = walk("server/routes").some(f => /withdraw|payout/i.test(read(f)));
    expect(hasPayoutRoute).toBe(false);
    const dict = read("src/lib/i18n.dict.ts") + read("src/routes/_site.earn.tsx");
    defect(() => expect(dict).not.toMatch(/Available to withdraw|可提現|可提取|cash you can withdraw/));
  });
});
