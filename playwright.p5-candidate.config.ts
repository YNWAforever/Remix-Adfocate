import {defineConfig} from '@playwright/test';

export default defineConfig({
 testDir:'./e2e',
 testMatch:'p5-candidate-freeze.spec.ts',
 fullyParallel:false,
 workers:1,
 retries:0,
 timeout:90000,
 expect:{timeout:10000},
 reporter:[['line'],['json',{outputFile:'.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-browser-results.json'}]],
 use:{
  channel:'chrome',
  locale:'zh-HK',
  timezoneId:'Asia/Hong_Kong',
  actionTimeout:10000,
  trace:'off',
  screenshot:'off',
  video:'off',
  launchOptions:{args:['--disable-crash-reporter','--disable-breakpad','--host-resolver-rules=MAP * ~NOTFOUND']},
 },
});
