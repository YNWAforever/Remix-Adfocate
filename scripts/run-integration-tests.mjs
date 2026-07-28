import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const publicationProofPreflightFile = "server/test/publication-proof-asset-grant-live.test.ts";

export const integrationFiles = [
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
  "server/test/active-mission-schema.test.ts",
  "server/test/active-missions.test.ts",
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

export function launchIntegrationTests({
  processRef = process,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
} = {}) {
  const env = { ...processRef.env, RUN_INTEGRATION: "1" };
  const preflight = spawnSyncImpl(
    processRef.execPath,
    [vitest, "run", "--no-file-parallelism", publicationProofPreflightFile],
    { cwd: processRef.cwd(), env, stdio: "inherit" },
  );
  if (preflight.error) {
    processRef.stderr.write(`${preflight.error}\n`);
    processRef.exit(1);
    return null;
  }
  if (preflight.signal) {
    processRef.kill(processRef.pid, preflight.signal);
    return null;
  }
  if (preflight.status !== 0) {
    processRef.exit(preflight.status ?? 1);
    return null;
  }
  const child = spawnImpl(
    processRef.execPath,
    [vitest, "run", "--no-file-parallelism", ...integrationFiles],
    {
      cwd: processRef.cwd(),
      env,
      stdio: "inherit",
    },
  );
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = new Map(signals.map((signal) => [
    signal,
    () => {
      if (!child.killed) child.kill(signal);
    },
  ]));
  const cleanup = () => {
    for (const [signal, handler] of handlers) {
      processRef.removeListener(signal, handler);
    }
  };

  for (const [signal, handler] of handlers) processRef.on(signal, handler);
  child.once("error", (error) => {
    cleanup();
    processRef.stderr.write(`${error}\n`);
    processRef.exit(1);
  });
  child.once("exit", (code, signal) => {
    cleanup();
    if (signal) {
      processRef.kill(processRef.pid, signal);
      return;
    }
    processRef.exit(code ?? 1);
  });

  return child;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  launchIntegrationTests();
}
