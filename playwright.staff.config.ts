import { defineConfig } from "@playwright/test";
import quality from "./playwright.quality.config";
export default defineConfig({...quality,testMatch:"staff-access.spec.ts",reporter:[["line"],["json",{outputFile:".codex-tmp/D18-browser-results.private.json"}]]});
