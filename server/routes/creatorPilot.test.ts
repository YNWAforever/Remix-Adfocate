// @vitest-environment node
import {Hono} from 'hono';
import {expect,it,vi} from 'vitest';
import type {Env} from '../app.js';
import {createCreatorPilotRoutes,createPilotMediaRoutes} from './creatorPilot.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const jwt=`x.${Buffer.from(JSON.stringify({sub:id(11),session_id:id(99)})).toString('base64url')}.x`;
it('is disabled without dependencies and derives actor only from verified middleware',async()=>{
 const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('workspaceId',id(1));c.set('userId',id(11));c.set('jwt',jwt);await next();});
 const preview=vi.fn(async()=>({mode:'pilot',sampleOnly:false})),create=vi.fn((actor:unknown)=>{expect(actor).toBeTruthy();return {preview} as never;});app.route('/disabled',createCreatorPilotRoutes());app.route('/pilot',createCreatorPilotRoutes({create}));
 const request=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 expect((await request('/disabled/preview',{})).status).toBe(503);
 expect((await request('/pilot/preview',{submissionId:id(21),workItemId:id(31),creatorId:id(12)})).status).toBe(400);expect(create).not.toHaveBeenCalled();
 expect((await request('/pilot/preview',{submissionId:id(21),workItemId:id(31)})).status).toBe(200);expect(create.mock.calls[0][0]).toMatchObject({workspaceId:id(1),creatorId:id(11)});
 expect(preview).toHaveBeenCalledWith(jwt,id(21),id(31));
});
it('serves only explicit final JPEG reads without caching; default route never reads',async()=>{
 const read=vi.fn(async()=>new Uint8Array([255,216,255,217]));const app=new Hono();app.route('/disabled',createPilotMediaRoutes());app.route('/',createPilotMediaRoutes({read}));
 const path=`/pilot/${id(1)}/${id(11)}/${id(91)}/${id(81)}.jpg`;
 expect((await app.request('/disabled'+path)).status).toBe(404);expect(read).not.toHaveBeenCalled();
 const result=await app.request(path);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(result.headers.get('content-type')).toBe('image/jpeg');
});

