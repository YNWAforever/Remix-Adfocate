import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import process from 'node:process';
import {build} from 'vite';

const temporaryRoot=resolve('.superpowers/p5-candidate-browser-temp');
mkdirSync(temporaryRoot,{recursive:true});
Object.assign(process.env,{
 TMP:temporaryRoot,
 TEMP:temporaryRoot,
 TMPDIR:temporaryRoot,
});

await build({configFile:'vite.p5-candidate.config.ts',mode:'p5-candidate-offline'});
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=playwright.p5-candidate.config.ts',...process.argv.slice(2)],{
 cwd:process.cwd(),
 env:{...process.env,NO_COLOR:'1'},
 stdio:'inherit',
});
process.exitCode=result.status??1;
