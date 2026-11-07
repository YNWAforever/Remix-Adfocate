// @vitest-environment node
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {NativeMediaLeaseStore,type NativeLeaseStorage} from './nativeMediaLease.js';
const owner={workspaceId:'00000000-0000-4000-8000-000000000001',creatorId:'00000000-0000-4000-8000-000000000011'},intentId='00000000-0000-4000-8000-000000000091',assetId='00000000-0000-4000-8000-000000000071';
const bytes=new Uint8Array([255,216,255,217]),sha256=createHash('sha256').update(bytes).digest('hex'),input={owner,intentId,approvedAssetId:assetId,sha256,ttlSeconds:900 as const};
function setup(){const objects=new Map<string,string>(),reserved=new Set<string>();let now=new Date('2030-01-01T00:00:00Z');
 const storage:NativeLeaseStorage={provenance:'provider',publicOrigin:'https://media.example.invalid',reserveIntent:async(o,id)=>{const k=`${o.workspaceId}/${o.creatorId}/${id}`;if(reserved.has(k))return false;reserved.add(k);return true;},put:async(path,_bytes,expires)=>{objects.set(path,expires);},purge:async path=>{objects.delete(path);},verifyAbsent:async path=>!objects.has(path),purgeIntent:async(o,id)=>{for(const path of objects.keys())if(path.startsWith(`pilot/${o.workspaceId}/${o.creatorId}/${id}/`))objects.delete(path);return true;}};
 const load=vi.fn(async()=>({owner,id:assetId,bytes,sha256,mime:'image/jpeg' as const,width:640,height:640,validated:true as const,rights:'shareable' as const,sampleOnly:false as const}));
 const create=()=>new NativeMediaLeaseStore({now:()=>now,authorize:async()=>true,load,storage});
 return {create,objects,storage,load,advance:()=>{now=new Date(+now+900000);}};
}
it('uses only final JPEG namespace, retains reservation and recovers cleanup after reconstruction',async()=>{
 const f=setup(),store=f.create(),lease=await store.open(input);expect(lease.publicUrl).toMatch(/^https:\/\/media\.example\.invalid\/pilot\//);expect(f.objects.size).toBe(1);f.advance();expect(await store.isUsable(owner,intentId)).toBe(false);
 await f.create().close(owner,intentId);expect(f.objects.size).toBe(0);await expect(f.create().open(input)).rejects.toThrow();expect(f.objects.size).toBe(0);
});
it('redacts recovery purge errors and validates scope before calling storage',async()=>{
 const f=setup();f.storage.purgeIntent=async()=>{throw new Error('PRIVATE_SECRET');};await expect(f.create().close(owner,intentId)).rejects.toThrow('PILOT_MEDIA_PURGE_PENDING');
 await expect(f.create().close({...owner,creatorId:'../other'},intentId)).rejects.toThrow('PILOT_MEDIA_DENIED');
});
it('does not publish a lease after close completes while source loading is pending',async()=>{
 const f=setup(),a=await f.load();let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;}),pending=new Promise<void>(r=>{release=r;});
 f.load.mockImplementationOnce(async()=>{entered();await pending;return a;});const store=f.create(),opening=store.open(input);
 await ready;await store.close(owner,intentId);release();await expect(opening).rejects.toThrow('PILOT_MEDIA_DENIED');expect(f.objects.size).toBe(0);
});
