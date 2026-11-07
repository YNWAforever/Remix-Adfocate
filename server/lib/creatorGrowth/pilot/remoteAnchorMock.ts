import {randomUUID} from 'node:crypto';
import type {MockCheckpointAnchor} from './checkpointStoreMock.js';

type AnchorState={binding:string;sequence:number;id:string|null};
export type MockRemoteAudit={
 binding:string;
 sequence:number;
 previousId:string|null;
 checkoutId:string|null;
 writerEpoch:number;
};
export type MockRemoteFault='commit_before_apply'|'commit_after_apply';
export type MockRemoteAnchor=MockCheckpointAnchor&{
 audit():MockRemoteAudit[];
 setAvailable(available:boolean):void;
 setNextFault(fault:MockRemoteFault):void;
};
export type MockRemoteAuthority={
 client():MockRemoteAnchor;
 audit():MockRemoteAudit[];
 promoteWriter():number;
 writerEpoch():number;
};
export type MockRemoteCheckpointStore=Readonly<{id:string}>;
type MockRemoteBackend={states:Map<string,AnchorState>;events:MockRemoteAudit[];epoch:number};

const isDigest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const isValidState=(state:AnchorState)=>{
 if(!state||!isDigest(state.binding)||!Number.isSafeInteger(state.sequence)||state.sequence<0||state.sequence>1000)return false;
 return state.sequence===0?state.id===null:isDigest(state.id);
};

const backends=new WeakMap<MockRemoteCheckpointStore,MockRemoteBackend>();
export function createMockRemoteCheckpointStore():MockRemoteCheckpointStore{
 const store=Object.freeze({id:randomUUID()});
 backends.set(store,{states:new Map(),events:[],epoch:0});
 return store;
}
export function forkMockRemoteCheckpointStore(source:MockRemoteCheckpointStore):MockRemoteCheckpointStore{
 const backend=backends.get(source);
 if(!backend)throw Error('MOCK_REMOTE_STORE_INVALID');
 const store=Object.freeze({id:randomUUID()});
 backends.set(store,{
  states:new Map([...backend.states].map(([binding,state])=>[binding,{...state}])),
  events:structuredClone(backend.events),
  epoch:backend.epoch,
 });
 return store;
}

/** In-memory remote-CAS simulation. No network, identity or provider calls. */
export function createMockRemoteCheckpointAuthority(store:MockRemoteCheckpointStore=createMockRemoteCheckpointStore()):MockRemoteAuthority{
 const backend=backends.get(store);
 if(!backend)throw Error('MOCK_REMOTE_STORE_INVALID');
 const {states,events}=backend;
 const client=():MockRemoteAnchor=>{
  let available=true;
  let fault:MockRemoteFault|undefined;
  const writerEpoch=backend.epoch;
  const assertAvailable=()=>{if(!available)throw Error('MOCK_REMOTE_UNAVAILABLE');};
  const assertCurrentWriter=()=>{if(backend.epoch!==writerEpoch)throw Error('MOCK_REMOTE_FENCED');};
  return {
   read(binding){
    assertAvailable();
    assertCurrentWriter();
    if(!isDigest(binding))throw Error('MOCK_ANCHOR_INVALID');
    return structuredClone(states.get(binding)??null);
   },
   advance(expected,next){
    assertAvailable();
    assertCurrentWriter();
    if(!isValidState(next)||(expected!==null&&(!isValidState(expected)||expected.binding!==next.binding)))throw Error('MOCK_ANCHOR_INVALID');
    const current=states.get(next.binding)??null;
    if(JSON.stringify(current)!==JSON.stringify(expected)||(current?next.sequence!==current.sequence+1:next.sequence!==0))throw Error('MOCK_ANCHOR_STALE');
    if(fault==='commit_before_apply'){fault=undefined;throw Error('MOCK_REMOTE_COMMIT_UNCONFIRMED');}
    states.set(next.binding,{binding:next.binding,sequence:next.sequence,id:next.id});
    events.push({binding:next.binding,sequence:next.sequence,previousId:current?.id??null,checkoutId:next.id,writerEpoch});
    if(fault==='commit_after_apply'){fault=undefined;throw Error('MOCK_REMOTE_ACK_UNKNOWN');}
   },
   audit(){return structuredClone(events);},
   setAvailable(nextAvailable){available=nextAvailable;},
   setNextFault(nextFault){
    if(!['commit_before_apply','commit_after_apply'].includes(nextFault))throw Error('MOCK_ANCHOR_INVALID');
    fault=nextFault;
   },
  };
 };
 return {
  client,
  audit(){return structuredClone(events);},
  promoteWriter(){
   if(backend.epoch>=Number.MAX_SAFE_INTEGER)throw Error('MOCK_REMOTE_FENCED');
   backend.epoch+=1;
   return backend.epoch;
  },
  writerEpoch(){return backend.epoch;},
 };
}
export function createMockRemoteCheckpointAnchor():MockRemoteAnchor{
 return createMockRemoteCheckpointAuthority().client();
}
