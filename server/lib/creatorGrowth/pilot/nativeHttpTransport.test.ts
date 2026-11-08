// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {NativePilotHttpTransport} from './nativeHttpTransport.js';
const account={product:'facebook_login' as const,appId:'11111',accountSubject:'22222',connectionId:'00000000-0000-4000-8000-000000000061',grantGeneration:1};
function setup(){const wire=vi.fn<(url:string,init:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify({id:'33333'})));const authorize=vi.fn(async()=>true);return {wire,authorize,transport:new NativePilotHttpTransport({version:'v99.0',account,authorize,token:async()=> 'LOCAL_FAKE_TOKEN',send:wire,mediaOrigin:'https://media.example.invalid',now:()=>new Date('2026-11-06T00:00:00Z')})};}
it('builds a fixed product request with bearer secret outside URL and limits payload',async()=>{
 const {transport,wire}=setup();await transport.request({operation:'create',account,payload:{caption:'Approved #合作',image_url:'https://media.example.invalid/pilot/approved.jpg',is_paid_partnership:true,branded_content_sponsor_ids:['44444']}});
 const [url,init]=wire.mock.calls[0];expect(url).toBe('https://graph.facebook.com/v99.0/22222/media');expect(url).not.toContain('TOKEN');expect(init.redirect).toBe('error');expect(init.headers).toEqual({Authorization:'Bearer LOCAL_FAKE_TOKEN','Content-Type':'application/json'});expect(JSON.parse(String(init.body))).not.toHaveProperty('access_token');
});
it('refuses target substitution, arbitrary media hosts, unknown fields and missing permission without calls',async()=>{
 const {transport,wire,authorize}=setup();
 for(const payload of [{creation_id:'33333',access_token:'injected'},{creation_id:'../me'},{creation_id:'33333',url:'http://127.0.0.1'}])await expect(transport.request({operation:'publish',account,payload})).rejects.toThrow('PILOT_TRANSPORT_DENIED');
 await expect(transport.request({operation:'create',account,payload:{caption:'x',image_url:'http://127.0.0.1/',is_paid_partnership:true,branded_content_sponsor_ids:['44444']}})).rejects.toThrow('PILOT_TRANSPORT_DENIED');
 await expect(transport.request({operation:'media',account:{...account,appId:'999'},payload:{media_id:'33333'}})).rejects.toThrow();
 authorize.mockResolvedValue(false);await expect(transport.request({operation:'status',account,payload:{container_id:'33333'}})).rejects.toThrow('PILOT_TRANSPORT_DENIED');expect(wire).not.toHaveBeenCalled();
});
it('rechecks authority after secret lookup and sanitizes ambiguous errors without retry',async()=>{
 const wire=vi.fn(async()=>{throw new Error('secret RAW_TOKEN');});let allowed=true;
 const transport=new NativePilotHttpTransport({version:'v99.0',account,authorize:async()=>allowed,token:async()=>{allowed=false;return 'RAW_TOKEN';},send:wire,mediaOrigin:'https://media.example.invalid'});
 await expect(transport.request({operation:'publish',account,payload:{creation_id:'33333'}})).rejects.toThrow('PILOT_TRANSPORT_DENIED');expect(wire).not.toHaveBeenCalled();
 const s=setup();s.wire.mockRejectedValue(new Error('RAW_TOKEN'));await expect(s.transport.request({operation:'publish',account,payload:{creation_id:'33333'}})).rejects.toThrow('PILOT_OUTCOME_UNKNOWN');expect(s.wire).toHaveBeenCalledTimes(1);
});
it('bounds malformed/oversized and provider-error responses',async()=>{
 for(const response of [new Response('not json'),new Response(JSON.stringify({error:{message:'RAW_TOKEN'}})),new Response('x'.repeat(65537)),new Response('{}',{status:429})]){
  const s=setup();s.wire.mockResolvedValue(response);await expect(s.transport.request({operation:'status',account,payload:{container_id:'33333'}})).rejects.toThrow('PILOT_OUTCOME_UNKNOWN');expect(s.wire).toHaveBeenCalledTimes(1);
 }
});
it('redacts credential and authority failures before transport',async()=>{
 for(const step of ['token','authorize']){
  const wire=vi.fn();
  const transport=new NativePilotHttpTransport({version:'v99.0',account,authorize:async()=>{if(step==='authorize')throw new Error('RAW_SECRET');return true;},token:async()=>{throw new Error('RAW_SECRET');},send:wire,mediaOrigin:'https://media.example.invalid'});
  await expect(transport.request({operation:'publish',account,payload:{creation_id:'33333'}})).rejects.toThrow('PILOT_TRANSPORT_DENIED');expect(wire).not.toHaveBeenCalled();
 }
});
