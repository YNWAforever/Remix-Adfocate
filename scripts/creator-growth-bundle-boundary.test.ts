// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_MARKERS = [
  "CONTROLLED_PILOT_MOCK_ONLY",
  "/api/controlled-pilot-mock",
  "creator_pilot_fixture_command",
  "MISSION_PUBLISH_ENTRY_MOCK_ONLY",
  "MissionPublishEntryDev",
  "茶日和 · 核准作品發佈練習",
  "任務發佈演練",
  "核准作品，準備見觀眾",
  "SAVED_OUTPUT_MOCK_ONLY",
  "成果收藏練習（合成示例）",
  "合成新版：茶杯近鏡",
  "合成舊版：先介紹",
  "查看合成示例",
  "View synthetic example",
  "合成示例 · 未驗證",
  "Synthetic example · unverified",
  "合成手動示例",
  "Synthetic manual example",
  "sample-official-metrics",
  "sample-image-asset",
  "sample-public-image",
  "GrowthImageWorkspaceDev",
  "開啟發佈模擬（開發用）",
  "Open publishing simulation (development only)",
  "開發專用合成流程",
  "synthetic-publish-preview-",
  "synthetic-publish-nonce-",
  "kocmax_demo_only",
  "synthetic-account-only",
  "synthetic-app-only",
  "synthetic-approved-version",
  "synthetic-image-only",
  "SAMPLE_DRAFT",
  "LOCAL SYNTHETIC SAMPLE",
  "離線原生流程演練",
  "Offline native pipeline rehearsal",
  "DEMO_PROOF_UNAVAILABLE",
  "示例審核證據",
  "Demo review evidence",
  "DEMO_REVIEW_INVALID",
  "示例流程進度",
  "Demo journey progress",
  "kocmax.mock-review.v1",
  "kocmax-mock-review.json",
  "DEMO_SUMMARY_INVALID",
  "DEMO_REVOKE_INVALID",
  "示例授權已撤銷",
  "Demo authorization revoked",
  "模擬圖片轉換失敗",
  "Simulate image conversion failure",
  "Deliberate failure fixture",
  "kocmax_demo_other",
  "DEMO_TARGET_INVALID",
  "Switch demo target (confirm again)",
  "LOCAL_STUDIO_LOGIN_REQUIRED",
  "工作室需要登入（模擬）",
  "LOCAL_STUDIO_COMMAND_LOGIN_REQUIRED",
  "操作時需要登入（模擬）",
  "LOCAL_SOURCE_LOGIN_REQUIRED",
  "來源需要登入（模擬）",
  "擁有者 A 私人討論（合成示例）",
  "這段私人討論只屬於擁有者 A",
  "00000000-0000-4000-8000-000000000901",
] as const;

function removeBundleOutput(scratch: string, outDir: string): void {
  const resolvedOutDir = realpathSync(outDir);
  if (resolvedOutDir !== outDir || dirname(resolvedOutDir) !== scratch) {
    throw new Error("Bundle test output moved outside its scratch directory");
  }
  rmSync(resolvedOutDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function buildProductionJavaScript(): string[] {
  const root = realpathSync(process.cwd());
  const scratch = join(root, ".superpowers");
  mkdirSync(scratch, { recursive: true });
  if (realpathSync(scratch) !== scratch) throw new Error("Bundle test scratch must be inside the worktree");
  const outDir = mkdtempSync(join(scratch, "creator-growth-bundle-"));
  try {
    // The release build runs source checks separately. Use its actual emitter
    // and configuration here; Vite's router plugin generates the route tree.
    const result = spawnSync(process.execPath, [
      join(root, "node_modules", "vite", "bin", "vite.js"),
      "build", "--config", join(root, "vite.config.ts"), "--mode", "production",
      "--outDir", outDir, "--emptyOutDir",
    ], {
      cwd: root,
      env: {
        ...process.env,
        CI: "true",
        NODE_ENV: "production",
        VITE_STUDIO_FIXTURE: "false",
        VITE_STUDIO_SHELL: "true",
        VITE_STUDIO_THREADS: "true",
        VITE_SUPABASE_URL: "https://example.invalid",
        VITE_SUPABASE_ANON_KEY: "offline-build-placeholder",
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
    });
    if (result.error || result.status !== 0) {
      const details = [result.stdout, result.stderr].filter(Boolean).join("\n")
        .trim().split(/\r?\n/).slice(-12).join("\n");
      const reason = result.error?.message ?? `exit ${result.status ?? result.signal}`;
      throw new Error(`Vite production build failed (${reason}).\n${details}`);
    }
    const assets = join(outDir, "assets");
    return readdirSync(assets, { withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith(".js"))
      .map((file) => readFileSync(join(assets, file.name), "utf8"));
  } finally {
    removeBundleOutput(scratch, outDir);
  }
}

describe("creator growth opt-in production boundary", () => {
  it("does not emit a synthetic trigger, report copy, or fixture identifiers", () => {
    const emittedJavaScript = buildProductionJavaScript();
    expect(emittedJavaScript.some((chunk) => chunk.length > 0), "fresh build emitted no JavaScript").toBe(true);
    const foundMarkers = FORBIDDEN_MARKERS.filter((marker) =>
      emittedJavaScript.some((chunk) => chunk.includes(marker)),
    );
    expect(foundMarkers).toEqual([]);
  }, 200_000);
});
