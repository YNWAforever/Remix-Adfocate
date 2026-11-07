import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';

export type CandidateFile={path:string;size:number;executable:boolean;sha256:string};
export type CandidateConfigField={
 name:string;
 classification:'public'|'server-only'|'secret-reference';
 required:boolean;
 present:boolean;
};
export type CandidateCore={
 version:1;
 candidateId:string;
 generatedAt:string;
 branch:string;
 head:string;
 dirtyWorktree:boolean;
 files:CandidateFile[];
 configContract:CandidateConfigField[];
 executionAllowed:false;
};

const MAX_FILE_BYTES=16*1024*1024;
const MAX_FILES=10000;
const ROOT_FILES=new Set([
 '.env.example',
 '.gitignore',
 'index.html',
 'package.json',
 'package-lock.json',
 'tsconfig.json',
 'vite.config.ts',
 'vite.p5-candidate.config.ts',
 'vitest.config.ts',
 'eslint.config.js',
 'vercel.json',
 'vercel.pilot.json',
]);
const ROOT_PREFIXES=['.github/','api/','e2e/','public/','scripts/','server/','src/','tests/','supabase/migrations/'];
const SUPABASE_FILES=new Set(['supabase/config.toml','supabase/release-manifest.json','supabase/seed.sql']);
const CONFIG_FIELDS:readonly Omit<CandidateConfigField,'present'>[]=[
 {name:'SUPABASE_URL',classification:'server-only',required:true},
 {name:'SUPABASE_ANON_KEY',classification:'server-only',required:true},
 {name:'SUPABASE_SERVICE_KEY',classification:'secret-reference',required:true},
 {name:'VITE_SUPABASE_URL',classification:'public',required:true},
 {name:'VITE_SUPABASE_ANON_KEY',classification:'public',required:true},
 {name:'VITE_DEFAULT_WORKSPACE',classification:'public',required:true},
 {name:'BOOTSTRAP_WORKSPACE_SLUGS',classification:'server-only',required:false},
 {name:'INTEGRATIONS_ENABLED',classification:'server-only',required:true},
 {name:'INTEGRATIONS_MODE',classification:'server-only',required:true},
 {name:'INSTAGRAM_CONNECTIONS_ENABLED',classification:'server-only',required:true},
 {name:'DRIVE_CONNECTIONS_ENABLED',classification:'server-only',required:true},
 {name:'INTEGRATIONS_PILOT_STAGE',classification:'server-only',required:true},
 {name:'INTEGRATIONS_KEYRING',classification:'secret-reference',required:true},
 {name:'PILOT_APPROVAL_REFERENCE',classification:'server-only',required:true},
 {name:'PILOT_MAINTENANCE_SECRET',classification:'secret-reference',required:true},
 {name:'PILOT_PUBLIC_ORIGIN',classification:'public',required:true},
 {name:'META_APP_ID',classification:'server-only',required:true},
 {name:'META_APP_VERSION',classification:'server-only',required:true},
 {name:'META_REDIRECT_URI',classification:'server-only',required:true},
 {name:'META_DEAUTHORIZATION_URL',classification:'server-only',required:true},
 {name:'META_DATA_DELETION_URL',classification:'server-only',required:true},
 {name:'META_DATA_DELETION_STATUS_URL',classification:'server-only',required:true},
 {name:'MEDIA_PUBLIC_ORIGIN',classification:'public',required:true},
 {name:'PILOT_WORKSPACE_ID',classification:'server-only',required:true},
 {name:'PILOT_RUN_ID',classification:'server-only',required:true},
];
const SECRET_PATTERNS=[
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\bghp_[A-Za-z0-9]{20,}\b/,
 /\bxox[bap]-[A-Za-z0-9-]{20,}\b/,
 /\bAKIA[0-9A-Z]{16}\b/,
 /\bsk-[A-Za-z0-9]{20,}\b/,
];

const git=(root:string,args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const canonical=(value:unknown)=>JSON.stringify(value);
const fileDigest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=(code:string):never=>{throw Error(code);};
const allowed=(path:string)=>ROOT_FILES.has(path)||ROOT_PREFIXES.some(prefix=>path.startsWith(prefix))||SUPABASE_FILES.has(path)
 || /^playwright(?:\.[a-z0-9-]+)?\.config\.ts$/.test(path)
 || /^docs\/review\/kocmax-controlled-pilot\/[a-z0-9-]+\.sql$/.test(path);
const safeRelative=(path:string)=>typeof path==='string'&&path.length>0&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes(':')&&!path.split('/').some(part=>!part||part==='.'||part==='..');

function configContract(example:string):CandidateConfigField[]{
 const names=new Set(example.split(/\r?\n/).map(line=>line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter((name):name is string=>Boolean(name)));
 return CONFIG_FIELDS.map(field=>({...field,present:names.has(field.name)}));
}

function assertNoSecretLikeContent(files:readonly {path:string;bytes:Buffer}[]){
 for(const file of files){
  if(file.bytes.includes(0))continue;
  const text=file.bytes.toString('utf8');
  if(SECRET_PATTERNS.some(pattern=>pattern.test(text)))fail(`CANDIDATE_SECRET_LIKE_CONTENT:${file.path}`);
  if(file.path==='.env.example'){
   for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\s*([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*=\s*(.+)$/);
    if(match&&match[2].trim()&&!['""',"''",'false','0'].includes(match[2].trim()))fail(`CANDIDATE_SECRET_LIKE_CONTENT:${file.path}:${match[1]}`);
   }
  }
 }
}

export async function buildCandidateCore(rootInput:string):Promise<CandidateCore>{
 const root=await realpath(rootInput);
 const names=git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean).map(path=>path.replaceAll('\\','/')).filter(allowed).sort();
 if(!names.length||names.length>MAX_FILES)fail('CANDIDATE_SELECTION_INVALID');
 const files:CandidateFile[]=[],contents:{path:string;bytes:Buffer}[]=[];
 for(const path of names){
  if(!safeRelative(path))fail(`CANDIDATE_PATH_INVALID:${path}`);
  const absolute=resolve(root,path),rel=relative(root,absolute);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||rel.replaceAll('\\','/')!==path)fail(`CANDIDATE_PATH_INVALID:${path}`);
  let cursor=root;
  for(const component of path.split('/')){
   cursor=resolve(cursor,component);
   const componentStat=await lstat(cursor);
   if(componentStat.isSymbolicLink())fail(`CANDIDATE_SYMLINK:${path}`);
  }
  const stat=await lstat(absolute);
  if(!stat.isFile())fail(`CANDIDATE_FILE_INVALID:${path}`);
  if(stat.size>MAX_FILE_BYTES)fail(`CANDIDATE_FILE_TOO_LARGE:${path}`);
  const bytes=await readFile(absolute);contents.push({path,bytes});
  files.push({path,size:bytes.length,executable:Boolean(stat.mode&0o111),sha256:fileDigest(bytes)});
 }
 assertNoSecretLikeContent(contents);
 const example=contents.find(file=>file.path==='.env.example')?.bytes.toString('utf8')??'';
 const branch=git(root,['rev-parse','--abbrev-ref','HEAD']),head=git(root,['rev-parse','HEAD']);
 if(!/^[a-f0-9]{40}$/.test(head))fail('CANDIDATE_GIT_INVALID');
 const dirtyWorktree=Boolean(git(root,['status','--porcelain=v1','--untracked-files=all']));
 const payload={version:1 as const,branch,head,dirtyWorktree,files,configContract:configContract(example),executionAllowed:false as const};
 return {candidateId:fileDigest(Buffer.from(canonical(payload))),generatedAt:new Date().toISOString(),...payload};
}

export async function verifyCandidateCore(root:string,core:unknown):Promise<{verified:boolean;blockers:string[];executionAllowed:false}>{
 const blockers:string[]=[];
 const record=core&&typeof core==='object'&&!Array.isArray(core)?core as Partial<CandidateCore>:null;
 if(!record||record.version!==1||record.executionAllowed!==false)return {verified:false,blockers:['candidate_contract'],executionAllowed:false};
 if(!/^[a-f0-9]{64}$/.test(String(record.candidateId)))blockers.push('candidate_id_invalid');
 if(typeof record.generatedAt!=='string'||!Number.isFinite(Date.parse(record.generatedAt)))blockers.push('candidate_time_invalid');
 if(!Array.isArray(record.files)||record.files.some(file=>!file||!safeRelative(file.path)||!Number.isSafeInteger(file.size)||typeof file.executable!=='boolean'||!/^[a-f0-9]{64}$/.test(file.sha256)))return {verified:false,blockers:['candidate_files_invalid'],executionAllowed:false};
 let rebuilt:CandidateCore;
 try{rebuilt=await buildCandidateCore(root);}catch(error){
  const message=(error as Error).message;
  blockers.push(/^CANDIDATE_[A-Z_]/.test(message)?message.toLowerCase():'candidate_build_failed');
  return {verified:false,blockers:[...new Set(blockers)],executionAllowed:false};
 }
 if(record.branch!==rebuilt.branch)blockers.push('candidate_branch_changed');
 if(record.head!==rebuilt.head)blockers.push('candidate_head_changed');
 if(record.dirtyWorktree!==rebuilt.dirtyWorktree)blockers.push('candidate_dirty_state_changed');
 if(record.candidateId!==rebuilt.candidateId)blockers.push('candidate_id_changed');
 if(canonical(record.configContract)!==canonical(rebuilt.configContract))blockers.push('candidate_config_contract_changed');
 const recorded=Array.isArray(record.files)?record.files:[],current=new Map(rebuilt.files.map(file=>[file.path,file]));
 for(const file of recorded){
  const match=current.get(file.path);
  if(!match)blockers.push(`candidate_file_missing:${file.path}`);
  else if(canonical(file)!==canonical(match))blockers.push(`candidate_file_changed:${file.path}`);
  current.delete(file.path);
 }
 if(current.size)blockers.push('candidate_selection_changed');
 return {verified:blockers.length===0,blockers:[...new Set(blockers)],executionAllowed:false};
}
