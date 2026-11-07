// @vitest-environment node
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {Plugin, ViteDevServer, UserConfig, ConfigEnv, Connect} from 'vite';

const state=vi.hoisted(()=>({owned:false,events:[] as string[],release:undefined as undefined|(()=>Promise<void>)}));
vi.mock('@vitejs/plugin-react',()=>({default:()=>({name:'react-stub'})}));
vi.mock('@tailwindcss/vite',()=>({default:()=>({name:'css-stub'})}));
vi.mock('vite-tsconfig-paths',()=>({default:()=>({name:'paths-stub'})}));
vi.mock('@tanstack/router-plugin/vite',()=>({tanstackRouter:()=>({name:'router-stub'})}));
vi.mock('../server/lib/creatorGrowth/pilot/durableRuntime.js',()=>({openDurablePilot:async()=>{
 if(state.owned)throw Error('LOCAL_PILOT_IN_USE');
 state.owned=true;state.events.push('open');
 return {pilot:{},journey:{},privateWorkspace:{},close:vi.fn(async()=>{
  state.events.push('closing');await state.release?.();state.owned=false;state.events.push('closed');
 })};
}}));
vi.mock('../server/lib/creatorGrowth/pilot/mockApp.js',()=>({createControlledPilotMockApp:()=>({})}));
vi.mock('../server/devApi.js',()=>({createViteApiMiddleware:()=>vi.fn()}));
import config from '../vite.config';

function plugin(){
 const resolved=(config as (env:ConfigEnv)=>UserConfig)({command:'serve',mode:'development'});
 return resolved.plugins!.find(p=>(p as Plugin).name==='local-hono-api') as Plugin;
}
async function configure(p:Plugin,server:ViteDevServer){await (p.configureServer as (server:ViteDevServer)=>unknown)(server);}
async function close(p:Plugin){await (p.closeBundle as ()=>unknown)();}
function server(restart=vi.fn(async()=>{})){
 return {restart,middlewares:{use:vi.fn()}} as unknown as ViteDevServer;
}
beforeEach(()=>{state.owned=false;state.events=[];state.release=undefined;vi.stubEnv('VITE_STUDIO_FIXTURE','true');});
afterEach(()=>vi.unstubAllEnvs());

it('awaits owner close before Vite configures a replacement, and old cleanup cannot close the new owner',async()=>{
 const old=plugin(),replacement=plugin();
 const next=server();
 // Installed Vite constructs/configures its replacement before closing the old server.
 const nativeRestart=vi.fn(async()=>{await configure(replacement,next);await close(old);});
 const current=server(nativeRestart);await configure(old,current);
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 state.release=()=>barrier;
 const restarting=current.restart(true);
 try{
  await vi.waitFor(()=>expect(state.events).toContain('closing'));
  expect(nativeRestart).not.toHaveBeenCalled();expect(state.owned).toBe(true);
  const middleware=vi.mocked(current.middlewares.use).mock.calls[0][0] as Connect.NextHandleFunction;
  const response={statusCode:200,end:vi.fn()},nextRequest=vi.fn();
  middleware({url:'/api/controlled-pilot-mock/status'} as Parameters<typeof middleware>[0],response as unknown as Parameters<typeof middleware>[1],nextRequest);
  expect(response.statusCode).toBe(503);expect(response.end).toHaveBeenCalledWith('LOCAL_PILOT_RESTARTING');
  expect(nextRequest).not.toHaveBeenCalled();
 }finally{release();await restarting;}
 expect(nativeRestart).toHaveBeenCalledWith(true);
 expect(state.events).toEqual(['open','closing','closed','open']);
 expect(state.owned).toBe(true);
 await close(old);expect(state.owned).toBe(true);
 await close(replacement);await close(replacement);
 expect(state.events).toEqual(['open','closing','closed','open','closing','closed']);
 expect(state.owned).toBe(false);
});

it('fails restart closed if releasing the owner fails',async()=>{
 const p=plugin(),nativeRestart=vi.fn(async()=>{}),current=server(nativeRestart);
 await configure(p,current);state.release=async()=>{throw Error('CLOSE_FAILED');};
 await expect(current.restart()).rejects.toThrow('CLOSE_FAILED');
 expect(nativeRestart).not.toHaveBeenCalled();expect(state.owned).toBe(true);
});
