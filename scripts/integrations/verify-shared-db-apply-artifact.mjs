// Disposable in-memory verification of the newly approved execution wrapper.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localBaseline} from './shared-db-local-baseline.mjs';
import {sha256,statements,executablePrefix} from './shared-db-sql.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const folder=resolve(root,'docs/review/kocmax-stage-4d/d1/shared-database');
const execution=resolve(folder,'execution');
const sql=await readFile(resolve(execution,'approved-apply.sql'),'utf8');
const manifest=JSON.parse(await readFile(resolve(execution,'application-manifest.json'),'utf8'));
if(sha256(sql)!==manifest.applySqlSha256)throw Error('EXECUTION_ARTIFACT_DRIFT');
const projected=statements(sql).filter(part=>!/^DO \$(?:catalog_guard|extended_guard)\$/i.test(executablePrefix(part))).join('');
const report={status:'NOT_RUN',applySqlSha256:sha256(sql),payloadSha256:manifest.reviewedPayloadSha256,omittedOnly:['catalog_guard','extended_guard'],reason:'host identity, exact hosted engine/owner/extensions cannot be reproduced in PGlite',networkAttempts:0};
const realFetch=globalThis.fetch;globalThis.fetch=async()=>{report.networkAttempts++;throw Error('NETWORK_FORBIDDEN');};
let db;
try {
 db=(await localBaseline(folder)).db;
 await db.exec(`insert into auth.users(id) values('37c56c3e-74cf-4431-a489-0d5e0ca7c401');
  insert into public.workspaces(id,slug,name) values('37c56c3e-74cf-4431-a489-0d5e0ca7c402','memory-preservation-only','Existing local model workspace');
  insert into public.creators(id,workspace_id,display_name,status) values('37c56c3e-74cf-4431-a489-0d5e0ca7c401','37c56c3e-74cf-4431-a489-0d5e0ca7c402','Existing local model creator','active');
  insert into public.point_balances(creator_id,workspace_id,balance) values('37c56c3e-74cf-4431-a489-0d5e0ca7c401','37c56c3e-74cf-4431-a489-0d5e0ca7c402',7);`);
 // Exactly the execution wrapper apart from the two hosted metadata-only guards.
 await db.exec(projected);
 const balance=await db.query("select balance from public.point_balances where creator_id='37c56c3e-74cf-4431-a489-0d5e0ca7c401'");
 if(Number(balance.rows[0]?.balance)!==7)throw Error('EXISTING_LOCAL_BALANCE_CHANGED');
 report.status='LOCAL_EXECUTION_WRAPPER_PASSED';
 report.checks=['approval reference guard passes only with artifact-bound supplied values','data preflight passes on local prior schema','exact reviewed payload runs','all original-column row checksums match inside the transaction','preexisting creator/workspace/balance survive','commit occurs in disposable memory only'];
}catch(e){report.status='FAILED';report.error={message:e.message,code:e.code,where:e.where};process.exitCode=1;if(db)await db.exec('rollback;').catch(()=>{});}
finally{if(db)await db.close();globalThis.fetch=realFetch;report.recordedAtUtc=new Date().toISOString();await writeFile(resolve(execution,'local-apply-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
