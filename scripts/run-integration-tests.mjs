import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const integrationFiles = [
  "server/test/rls.test.ts",
  "server/test/bootstrap.test.ts",
  "server/test/onboarding.test.ts",
  "server/test/missions.test.ts",
  "server/test/admin.test.ts",
  "server/test/admin-staff.test.ts",
  "server/test/redemption.test.ts",
  "server/test/wallet.test.ts",
  "server/test/me.test.ts",
  "server/test/leveling.test.ts",
  "server/test/passport.test.ts",
  "server/test/match.test.ts",
  "server/test/copilot.test.ts",
  "server/test/applications.test.ts",
  "server/test/social-schema.test.ts",
  "server/test/social.test.ts",
  "server/test/verificationGate.test.ts",
  "server/test/public-passport.test.ts",
  "server/test/cron-social-refresh.test.ts",
  "server/test/operator-crm-schema.test.ts",
  "server/test/operator-crm.test.ts",
  "server/test/assistant.test.ts",
  "server/test/adminContent.test.ts",
  "server/test/content.test.ts",
  "server/test/notifications-triggers.test.ts",
  "server/test/notifications-api.test.ts",
  "server/test/insights.test.ts",
  "server/test/radar.test.ts",
  "server/test/brand.test.ts",
  "server/test/campaigns.test.ts",
  "server/test/campaigns-s2.test.ts",
  "server/test/brandResources.test.ts",
  "server/test/academy.test.ts",
  "server/test/adminAcademy.test.ts",
  "server/test/academy-seed.test.ts",
];

const vitest = resolve("node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitest, "run", "--no-file-parallelism", ...integrationFiles],
  {
    cwd: process.cwd(),
    env: { ...process.env, RUN_INTEGRATION: "1" },
    stdio: "inherit",
  },
);

if (result.error) {
  process.stderr.write(`${result.error}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
