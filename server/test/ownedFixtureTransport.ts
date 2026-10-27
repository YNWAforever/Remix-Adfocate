// Test service transport only. User/RLS clients and the real application are never wrapped.
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
const ids=new Map<string,Set<string>>(),keys=new Map<string,string>();let loaded=false;
const uuid=/^[a-f0-9-]{36}$/i;
function remember(table:string,key:string,values:string[],write=true){
 const owned=ids.get(table)??new Set<string>();for(const id of values)if(uuid.test(id))owned.add(id);ids.set(table,owned);keys.set(table,key);
 if(write&&process.env.INTEGRATION_OWNED_JOURNAL&&values.length)appendFileSync(process.env.INTEGRATION_OWNED_JOURNAL,JSON.stringify({table,key,ids:values.filter(id=>uuid.test(id))})+'\n');
}
function load(){
 if(loaded)return;loaded=true;
 const seed=process.env.INTEGRATION_OWNED_IDS_PATH;
 if(seed){const data=JSON.parse(readFileSync(seed,'utf8'))as{tables:Record<string,{key:string;ids:string[]}>};for(const [table,row]of Object.entries(data.tables))remember(table,row.key,row.ids,false);}
 const journal=process.env.INTEGRATION_OWNED_JOURNAL;
 if(journal&&existsSync(journal))for(const line of readFileSync(journal,'utf8').trim().split('\n').filter(Boolean)){const row=JSON.parse(line)as{table:string;key:string;ids:string[]};remember(row.table,row.key,row.ids,false);}
}
export function ownsFixtureId(table:string,id:string){load();return Boolean(ids.get(table)?.has(id));}
export function fixtureOwnership(){load();return Object.fromEntries([...ids].map(([table,values])=>[table,{key:keys.get(table)!,ids:[...values]}]));}
export function captureFixtureRows(table:string,value:unknown){
 load();const rows=(Array.isArray(value)?value:[value]).filter((r):r is Record<string,unknown>=>Boolean(r)&&typeof r==='object');
 const key=['id','user_id','creator_id','workspace_id'].find(k=>rows.some(r=>typeof r[k]==='string'));
 if(key)remember(table,key,rows.flatMap(r=>typeof r[key]==='string'?[r[key]as string]:[]));
}
function exact(value:string|null):string[]|null{
 if(!value)return null;if(value.startsWith('eq.')&&uuid.test(value.slice(3)))return[value.slice(3)];
 if(value.startsWith('in.(')&&value.endsWith(')')){const values=value.slice(4,-1).split(',');return values.every(x=>uuid.test(x))?values:null;}return null;
}
const parents:Record<string,string>={creator_id:'creators',user_id:'auth_users',mission_id:'missions',campaign_id:'campaigns',workspace_id:'workspaces',gift_id:'redemption_gifts',mission_workflow_id:'mission_workflows',mission_work_item_id:'mission_work_items',submission_id:'mission_submissions'};
export function createOwnedFixtureFetch(delegate:typeof fetch=globalThis.fetch,authorizePristineCampaignJob?:(ownedCampaignIds:string[])=>void):typeof fetch{
 load();const origin=new URL(process.env.SUPABASE_URL!).origin;
 return async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  if(url.origin!==origin)return new Response(JSON.stringify({code:'FIXTURE_TARGET_MISMATCH',message:'Fixture transport cannot leave its verified target'}),{status:403});
  // These zero-argument RPCs mutate every due/active campaign, including older runs.
  // An owned child/workspace cannot constrain them. Require a separate pristine DB.
  if(method==='POST'&&['/rest/v1/rpc/close_due_campaigns','/rest/v1/rpc/snapshot_campaign_leaderboards'].includes(url.pathname)){
   try{if(!authorizePristineCampaignJob)throw new Error('No pristine target authority');authorizePristineCampaignJob(fixtureOwnership().campaigns?.ids??[]);}
   catch{return new Response(JSON.stringify({code:'FIXTURE_UNSCOPED_RPC',message:'Database-wide campaign jobs require a verified pristine target containing only current owned campaigns'}),{status:403});}
  }
  const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
  const match=/^\/rest\/v1\/([^/]+)$/.exec(url.pathname),table=match?.[1];
  if(table&&['PATCH','DELETE'].includes(method)){
   const key=keys.get(table)??'id',selected=exact(url.searchParams.get(key));let owned=ids.get(table)??new Set<string>();
   // A command may return a workflow ID before any service read of its row.
   // Resolve only exact parent IDs and attest their existing owned ancestor.
   for(const [field,parentTable] of Object.entries(parents)){
    const values=exact(url.searchParams.get(field));
    if(!values?.length||values.length>100||values.every(v=>ownsFixtureId(parentTable,v)))continue;
    const probe=new URL(`/rest/v1/${parentTable}`,origin);probe.searchParams.set('select','*');probe.searchParams.set('id',values.length===1?`eq.${values[0]}`:`in.(${values.join(',')})`);probe.searchParams.set('limit',String(values.length));
    const probeHeaders=new Headers(headers);probeHeaders.set('Accept','application/json');
    const inspected=await delegate(probe.href,{method:'GET',headers:probeHeaders});
    const rows:unknown=inspected.ok?await inspected.json().catch(()=>null):null;
    if(Array.isArray(rows)&&rows.length===values.length&&rows.every(r=>r&&values.includes(r.id)&&Object.entries(parents).some(([ancestor,ancestorTable])=>typeof r[ancestor]==='string'&&ownsFixtureId(ancestorTable,r[ancestor]))))captureFixtureRows(parentTable,rows);
   }
   const parent=Object.entries(parents).find(([field,parentTable])=>{const values=exact(url.searchParams.get(field));return values?.length&&values.every(v=>ownsFixtureId(parentTable,v));});
   // RPC/API-created child IDs are not service inserts. Attest their existing parent,
   // then keep the caller's exact ID selector; never infer ownership from a slug/name.
   if(selected?.length&&selected.length<=100&&!parent&&!selected.every(id=>owned.has(id))){
    const probe=new URL(url.href);probe.searchParams.set('select','*');probe.searchParams.set('limit',String(selected.length));
    const probeHeaders=new Headers(headers);probeHeaders.set('Accept','application/json');
    const inspected=await delegate(probe.href,{method:'GET',headers:probeHeaders});
    const rows:unknown=inspected.ok?await inspected.json().catch(()=>null):null;
    if(Array.isArray(rows)&&rows.length===selected.length&&rows.every(r=>r&&selected.includes(r[key])&&Object.entries(parents).some(([field,parentTable])=>typeof r[field]==='string'&&ownsFixtureId(parentTable,r[field]))))captureFixtureRows(table,rows);
    owned=ids.get(table)??owned;
   }
   if(selected&&!selected.every(id=>owned.has(id))&&!parent||!selected&&!parent&&!owned.size)return new Response(JSON.stringify({code:'FIXTURE_NOT_OWNED',message:'Only exact IDs captured in this fixture run may be changed'}),{status:403});
   if(!parent&&!selected)url.searchParams.append(key,`in.(${[...owned].join(',')})`);
  }
  if(table&&method==='POST')headers.set('Prefer',(headers.get('Prefer')??'').split(',').filter(x=>!x.startsWith('return=')).concat('return=representation').filter(Boolean).join(','));
  const response=await delegate(url.href, {...init,headers});
  if(response.ok&&method==='GET'&&table){
   const value:unknown=await response.clone().json().catch(()=>null);
   const rows=(Array.isArray(value)?value:[value]).filter((r):r is Record<string,unknown>=>Boolean(r)&&typeof r==='object');
   captureFixtureRows(table,rows.filter(r=>Object.entries(parents).some(([field,parentTable])=>typeof r[field]==='string'&&ownsFixtureId(parentTable,r[field]))));
  }
  if(response.ok&&method==='POST'){
   const value:unknown=await response.clone().json().catch(()=>null);
   if(table)captureFixtureRows(table,value);
   else if(url.pathname==='/auth/v1/admin/users'&&value&&typeof value==='object'){const user='user'in value?value.user:value;if(user&&typeof user==='object'&&'id'in user&&typeof user.id==='string')remember('auth_users','id',[user.id]);}
  }
  return response;
 };
}
