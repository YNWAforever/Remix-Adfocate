import {defineConfig} from '@playwright/test';
import process from 'node:process';
import quality from './playwright.quality.config';
// @ts-expect-error Native local identity helper.
import {b2ExecutionContext} from './scripts/audit/local-targets.mjs';
const selected=b2ExecutionContext();
const phase=process.env.ADFOCATE_BROWSER_PHASE==='roles'?'roles':'journey';
export default defineConfig({...quality,testMatch:['creator-operator-mission.spec.ts','staff-access.spec.ts'],reporter:[['line'],['json',{outputFile:selected?.privatePath(`browser-${phase}-results.private.json`)??`.codex-tmp/D19-browser-${phase}-results.private.json`}]]});
