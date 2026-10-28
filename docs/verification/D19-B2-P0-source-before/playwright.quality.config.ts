import { defineConfig } from "@playwright/test";
import process from "node:process";
export default defineConfig({testDir:"./e2e",fullyParallel:false,workers:1,retries:0,timeout:180000,expect:{timeout:20000},
 reporter:[["line"],["json",{outputFile:".codex-tmp/D17-browser-results.private.json"}]],
 use:{baseURL:"http://127.0.0.1:56400",channel:"msedge",viewport:{width:1280,height:900},locale:"en-HK",timezoneId:"Asia/Hong_Kong",trace:"off",screenshot:"off",video:"off"},
 webServer:{command:`"${process.execPath}" node_modules/vite-node/vite-node.mjs scripts/audit/serve-quality.ts`,url:"http://127.0.0.1:56400/api/health",reuseExistingServer:false,timeout:60000,stdout:"ignore",stderr:"pipe"},
});
