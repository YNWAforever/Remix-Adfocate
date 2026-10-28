import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {createHash} from 'node:crypto';
import {verifiedTarget} from '../scripts/audit/local-targets.mjs';
const phase=process.argv[2];if(!['before','after'].includes(phase))throw new Error('Explicit catalog phase required');
const read=p=>JSON.parse(readFileSync(p,'utf8')),put=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const identity=read('docs/verification/D19-current-identity.json');if(!identity.passed)throw new Error('Metadata gate required');
const prior=read('docs/verification/D19-runtime-catalog-after.json'),targets={};
// Verify both direct DB paths before the first SQL operation. No SDK import/client/setup.
for(const kind of ['empty','shaped']){
 const target=verifiedTarget(kind);if(!equal(target.identity,identity.targets[kind].identity))throw new Error('Target drift');
 const lines=readFileSync(`.codex-tmp/${kind}-start.private.log`,'utf8').split(/\r?\n/),keys=JSON.parse(lines.filter(l=>l.startsWith('{"DB_URL"')).at(-1));
 const db=new URL(keys.DB_URL),ports=JSON.parse(execFileSync('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',target.identity.databaseContainerId],{encoding:'utf8',timeout:10000}));
 if(db.hostname!=='127.0.0.1'||Number(db.port)!==identity.targets[kind].databaseBinding.port||keys.API_URL!==target.env.SUPABASE_URL||!(ports['5432/tcp']??[]).some(p=>p.HostIp==='127.0.0.1'&&p.HostPort===db.port))throw new Error('DB URL/container port mapping drift');
 targets[kind]=target;
}
const result={at:new Date().toISOString(),phase,sourceFingerprint:read('docs/verification/code-fingerprint.json').fingerprint,productionQueried:false,query:prior.query,targets:{}};
for(const [kind,t]of Object.entries(targets)){
 const observed=JSON.parse(t.sql(`begin read only;${prior.query}commit;`));
 if(!equal(observed,prior.targets[kind].observed))throw new Error('Schema/RPC/grants/RLS/history drift versus sealed D19: '+kind);
 const names=JSON.parse(t.sql("begin read only;select jsonb_agg(tablename order by tablename) from pg_tables where schemaname='public';commit;"));
 if(!names.every(n=>/^[a-z0-9_]+$/.test(n)))throw new Error('Unexpected identifier');
 const select=names.map(n=>`select '${n}'as name,coalesce(jsonb_agg(md5(to_jsonb(r)::text) order by md5(to_jsonb(r)::text)),'[]'::jsonb)as hashes from public.${n} r`);
 select.push("select 'auth.users'as name,coalesce(jsonb_agg(md5(to_jsonb(r)::text) order by md5(to_jsonb(r)::text)),'[]'::jsonb)as hashes from auth.users r");
 // Existing 1k/10k fixture history exceeds the shared helper's 1 MiB stdout cap.
 // Bound each read, preserving the existing helper and all application source.
 const payload=`select jsonb_object_agg(name,hashes)::text from (${select.join(' union all ')}) hashes`;
 const length=Number(t.sql(`begin read only;select length(payload) from (${payload}) q(payload);commit;`));
 let encoded='';for(let offset=1;offset<=length;offset+=262144)encoded+=t.sql(`begin read only;select substring(payload from ${offset} for 262144) from (${payload}) q(payload);commit;`);
 const hashes=JSON.parse(encoded);
 const rows={};for(const [name,values]of Object.entries(hashes))rows[name]={count:values.length,digest:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
 if(phase==='before')put(`.codex-tmp/D19-current-${kind}-rowhashes-before.private.json`,hashes);
 let preservation=null;
 if(phase==='after'){
  const before=read(`.codex-tmp/D19-current-${kind}-rowhashes-before.private.json`),changed=[];
  for(const [name,values]of Object.entries(before)){const current=new Set(hashes[name]);for(const hash of values)if(!current.has(hash))changed.push({table:name,rowHash:hash});}
  preservation={allPreExistingPublicAndAuthUserRowsPreserved:changed.length===0,changed,scope:'Existing public base rows and auth.users; excludes Auth sessions/logs and DB statistics. All new exact-owned fixture rows are retained.'};
  if(changed.length)throw new Error('Pre-existing isolated rows mutated: '+JSON.stringify(changed));
 }
 result.targets[kind]={identity:t.identity,observed,schemaMatchesSealedD19:true,historyRows:observed.history.length,rows,preservation};
 console.log(JSON.stringify({phase,kind,schemaMatched:true,history:observed.history.length,preExistingRowsPreserved:preservation?.allPreExistingPublicAndAuthUserRowsPreserved??null}));
}
const path=`docs/verification/D19-current-schema-${phase}.json`;if(existsSync(path))throw new Error('Retain previous catalog observation');put(path,result);
