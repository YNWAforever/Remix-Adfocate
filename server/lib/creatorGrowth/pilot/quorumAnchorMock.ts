import type {MockCheckpointAnchor} from './checkpointStoreMock.js';

type AnchorState={binding:string;sequence:number;id:string|null};
type Node={id:string;available:boolean;states:Map<string,AnchorState>;lastCommittedTerm:number};
export type MockQuorumAudit={
 binding:string;
 sequence:number;
 previousId:string|null;
 checkoutId:string|null;
 term:number;
 leaderId:string;
 committers:string[];
};
export type MockQuorumAnchor=MockCheckpointAnchor&{
 audit():MockQuorumAudit[];
 setAvailable(nodeId:string,available:boolean):void;
 status():{term:number;leaderId:string|null;quorumSize:number;online:string[]};
};

const isDigest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validNodeId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
const validState=(state:AnchorState)=>{
 if(!state||!isDigest(state.binding)||!Number.isSafeInteger(state.sequence)||state.sequence<0||state.sequence>1000)return false;
 return state.sequence===0?state.id===null:isDigest(state.id);
};
const equalState=(first:AnchorState|null,second:AnchorState|null)=>JSON.stringify(first)===JSON.stringify(second);

/** Unmounted five-node quorum simulation. No network, durability, identities or clock. */
export function createMockQuorumAnchor(nodeIds:string[]=['node-a','node-b','node-c','node-d','node-e']):MockQuorumAnchor{
 if(!Array.isArray(nodeIds)||nodeIds.length<3||nodeIds.length>9||nodeIds.length%2===0||new Set(nodeIds).size!==nodeIds.length||nodeIds.some(nodeId=>!validNodeId(nodeId)))throw Error('MOCK_QUORUM_CONFIG');
 const nodes:Node[]=nodeIds.map(id=>({id,available:true,states:new Map(),lastCommittedTerm:0}));
 const events:MockQuorumAudit[]=[];
 const quorumSize=Math.floor(nodes.length/2)+1;
 let term=0;
 let leaderId:string|null=null;

 const online=()=>nodes.filter(node=>node.available);
 const stateFor=(node:Node,binding:string)=>structuredClone(node.states.get(binding)??null);
 const elect=()=>{
  const available=online();
  if(available.length<quorumSize)throw Error('MOCK_QUORUM_UNAVAILABLE');
  const current=available.find(node=>node.id===leaderId);
  const highestTerm=Math.max(...available.map(node=>node.lastCommittedTerm));
  if(current&&current.lastCommittedTerm===highestTerm)return current;
  term+=1;
  const candidates=available.filter(node=>node.lastCommittedTerm===highestTerm).sort((first,second)=>first.id.localeCompare(second.id));
  const leader=candidates[0];
  if(!leader)throw Error('MOCK_QUORUM_UNAVAILABLE');
  leaderId=leader.id;
  return leader;
 };
 const agreeing=(binding:string,expected:AnchorState|null)=>{
  const available=online();
  const matches=available.filter(node=>equalState(stateFor(node,binding),expected));
  if(matches.length<quorumSize)throw Error('MOCK_QUORUM_DIVERGED');
  return matches;
 };
 return {
  read(binding){
   if(!isDigest(binding))throw Error('MOCK_ANCHOR_INVALID');
   const leader=elect(),state=stateFor(leader,binding);
   agreeing(binding,state);
   return structuredClone(state);
  },
  advance(expected,next){
   if(!validState(next)||(expected!==null&&(!validState(expected)||expected.binding!==next.binding)))throw Error('MOCK_ANCHOR_INVALID');
   const leader=elect();
   if(!equalState(stateFor(leader,next.binding),expected))throw Error('MOCK_ANCHOR_STALE');
   const committers=agreeing(next.binding,expected);
   if(committers.length<quorumSize)throw Error('MOCK_QUORUM_COMMIT_UNCONFIRMED');
   const event:MockQuorumAudit={binding:next.binding,sequence:next.sequence,previousId:expected?.id??null,checkoutId:next.id,term,leaderId:leader.id,committers:committers.map(node=>node.id).sort()};
   for(const node of committers){
    node.states.set(next.binding,{binding:next.binding,sequence:next.sequence,id:next.id});
    node.lastCommittedTerm=term;
   }
   events.push(event);
  },
  audit(){return structuredClone(events);},
  setAvailable(nodeId,available){
   const node=nodes.find(candidate=>candidate.id===nodeId);
   if(!node||typeof available!=='boolean')throw Error('MOCK_ANCHOR_INVALID');
   node.available=available;
   if(!available&&leaderId===nodeId)leaderId=null;
  },
  status(){
   const available=online().map(node=>node.id);
   const hasQuorum=available.length>=quorumSize;
   return {term,leaderId:hasQuorum&&leaderId&&available.includes(leaderId)?leaderId:null,quorumSize,online:available};
  },
 };
}
