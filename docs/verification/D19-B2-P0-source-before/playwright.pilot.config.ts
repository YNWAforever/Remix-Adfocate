import {defineConfig} from '@playwright/test';
import process from 'node:process';
import quality from './playwright.quality.config';
const phase=process.env.ADFOCATE_BROWSER_PHASE==='roles'?'roles':'journey';
export default defineConfig({...quality,testMatch:['creator-operator-mission.spec.ts','staff-access.spec.ts'],reporter:[['line'],['json',{outputFile:`.codex-tmp/D19-browser-${phase}-results.private.json`}]]});
