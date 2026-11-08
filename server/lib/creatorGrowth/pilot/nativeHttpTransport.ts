import {assertPilotAccount,assertSamePilotAccount,providerId,type PilotAccount} from './protocol.js';
type Dependencies={version:string;account:PilotAccount;authorize:()=>Promise<boolean>;token:()=>Promise<string>;send:(url:string,init:RequestInit)=>Promise<Response>;mediaOrigin:string;now?:()=>Date};
export class NativePilotHttpTransport{
 private readonly account:PilotAccount;
 private readonly version:string;
 private readonly origin:string;
 constructor(private readonly deps:Dependencies){
  assertPilotAccount(deps.account);this.account=Object.freeze({...deps.account});this.version=deps.version;
  const origin=new URL(deps.mediaOrigin);if(!/^v[1-9][0-9]*\.0$/.test(this.version)||origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PILOT_TRANSPORT_DENIED');this.origin=origin.origin;
 }
 /** Deliberately no default fetch, environment secrets or registration in app.ts.
  * The supplied server authority must verify protocol, run, grant and approved intent.
  * This transport returns untrusted provider-shaped data, never a verified receipt. */
 async request(input:{operation:'create'|'status'|'publish'|'media';account:PilotAccount;payload:Record<string,unknown>}):Promise<unknown>{
  const deny=():never=>{throw new Error('PILOT_TRANSPORT_DENIED');};
  assertSamePilotAccount(this.account,input.account);
  const p=structuredClone(input.payload);if(!p||typeof p!=='object'||Array.isArray(p))deny();
  let path:string,body:Record<string,unknown>|undefined;
  const exact=(keys:string[])=>{if(Object.keys(p).length!==keys.length||keys.some(k=>!Object.hasOwn(p,k)))deny();};
  if(input.operation==='create'){
   exact(['caption','image_url','is_paid_partnership','branded_content_sponsor_ids']);
   if(typeof p.caption!=='string'||!p.caption.trim()||[...p.caption].length>2200||p.is_paid_partnership!==true||!Array.isArray(p.branded_content_sponsor_ids)||p.branded_content_sponsor_ids.length<1||p.branded_content_sponsor_ids.length>2||new Set(p.branded_content_sponsor_ids).size!==p.branded_content_sponsor_ids.length||p.branded_content_sponsor_ids.some(id=>!providerId(id)||id===this.account.accountSubject))deny();
   try{const media=new URL(String(p.image_url));if(media.origin!==this.origin||media.username||media.password||media.hash||media.search||!/^\/pilot\/[a-zA-Z0-9_/-]+\.jpg$/.test(media.pathname))deny();}catch{deny();}
   path=`${this.account.accountSubject}/media`;body=p;
  }else if(input.operation==='publish'){exact(['creation_id']);if(!providerId(p.creation_id))deny();path=`${this.account.accountSubject}/media_publish`;body=p;}
  else if(input.operation==='status'){exact(['container_id']);if(!providerId(p.container_id))deny();path=`${p.container_id}?fields=status_code`;}
  else if(input.operation==='media'){exact(['media_id']);if(!providerId(p.media_id))deny();path=`${p.media_id}?fields=id,owner,permalink`;}
  else return deny();
  let token:string;
  try{
   if(!await this.deps.authorize())return deny();
   token=await this.deps.token();if(typeof token!=='string'||!token||token.length>16384||[...token].some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)>=127)||!await this.deps.authorize())return deny();
  }catch{return deny();}
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('PILOT_OUTCOME_UNKNOWN'));},15000);});
  try{
   return await Promise.race([timeout,(async()=>{
    const response=await this.deps.send(`https://graph.facebook.com/${this.version}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:abort.signal});
    if(!response.ok||response.redirected)throw new Error();
    const reader=response.body?.getReader();if(!reader)throw new Error();let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();throw new Error();}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    const result:unknown=JSON.parse(text);if(!result||typeof result!=='object'||Array.isArray(result)||'error' in result)throw new Error();return result;
   })()]);
  }catch{throw new Error('PILOT_OUTCOME_UNKNOWN');}finally{clearTimeout(timer);abort.abort();}
 }
}
