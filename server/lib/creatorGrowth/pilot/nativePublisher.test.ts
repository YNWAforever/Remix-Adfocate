// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {NativePilotHttpTransport} from './nativeHttpTransport.js';
import {NativePilotPublisher} from './nativePublisher.js';
const account={product:'facebook_login' as const,appId:'11111',accountSubject:'22222',connectionId:'00000000-0000-4000-8000-000000000061',grantGeneration:1};
function setup(){let verified=true;const wire=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('status_code')?{status_code:'FINISHED'}:url.includes('fields=id')?{id:'55555',owner:{id:'22222'},permalink:'https://www.instagram.com/p/example/'}:{id:url.includes('media_publish')?'55555':'33333'})));const transport=new NativePilotHttpTransport({account,version:'v99.0',mediaOrigin:'https://media.example.invalid',authorize:async()=>verified,token:async()=>'FAKE_TEST_TOKEN',send:wire});return {wire,setVerified:(v:boolean)=>{verified=v;},publisher:new NativePilotPublisher(account,transport,async()=>verified)};}
it('runs the native wire shape with fake HTTP and validates receipt identity',async()=>{
 const s=setup();expect(await s.publisher.createImageContainer({intentId:'00000000-0000-4000-8000-000000000091',target:account,imageSha256:'a'.repeat(64),caption:'Tea #合作',sponsorIds:['44444'],isPaidPartnership:true,mediaHandle:'https://media.example.invalid/pilot/approved.jpg'})).toEqual(expect.objectContaining({containerId:'33333',sampleOnly:false}));
 await s.publisher.getContainerStatus(account,'33333');await s.publisher.publishContainer(account,'33333');expect(await s.publisher.getPublishedMedia(account,'55555')).toEqual(expect.objectContaining({accountSubject:'22222',sampleOnly:false,provenance:'provider'}));expect(s.wire).toHaveBeenCalledTimes(4);
 await expect(s.publisher.publishContainer(account,'33333')).rejects.toThrow('PUBLISH_ALREADY_REQUESTED');expect(s.wire).toHaveBeenCalledTimes(4);
});
it('fails closed for unverified protocol and wrong-account media',async()=>{
 const s=setup();s.setVerified(false);await expect(s.publisher.getContainerStatus(account,'33333')).rejects.toThrow();expect(s.wire).not.toHaveBeenCalled();
 s.setVerified(true);s.wire.mockResolvedValueOnce(new Response(JSON.stringify({id:'55555',owner:{id:'99999'},permalink:'https://www.instagram.com/p/example/'})));await expect(s.publisher.getPublishedMedia(account,'55555')).rejects.toThrow();
});
