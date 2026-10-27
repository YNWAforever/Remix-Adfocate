import {describe,expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {addCreatorReviewNote,updateCreatorReview} from '../../server/lib/operatorCrm/repo';

// Fault model: each individual successful PostgREST operation is committed;
// only the later audit insert fails. This is not a PostgreSQL integration test.
function fixture(){
 const state:{notes:Array<Record<string,unknown>>;review:Record<string,unknown>|null}={notes:[],review:null};
 const client={rpc:async(name:string)=>{ const pending=structuredClone(state); if(name==="apply_creator_review_command") pending.review={status:"approved"}; else pending.notes.push({id:"pending-note"}); return {data:null,error:{message:"injected audit outage"}}; },from(table:string){
  let payload:Record<string,unknown>={};
  const query={
   select(){return query},eq(){return query},
   maybeSingle:async()=>({data:{id:'creator',workspace_id:'workspace'},error:null}),
   insert(value:Record<string,unknown>){payload=value;return table==='operator_audit_events'?Promise.resolve({data:null,error:{message:'injected audit outage'}}):query},
   upsert(value:Record<string,unknown>){payload=value;return query},
   single:async()=>{
    if(table==='creator_review_notes'){const note={id:`note-${state.notes.length+1}`,...payload};state.notes.push(note);return{data:note,error:null};}
    if(table==='creator_review_statuses'){state.review=payload;return{data:payload,error:null};}
    throw new Error(`Unexpected table ${table}`);
   },
  };return query;
 }} as unknown as SupabaseClient;
 return {client,state};
}
const context={operatorId:'synthetic-operator',actorLabel:'Synthetic operator',workspaceId:'workspace'};
describe('CRM partial-write acceptance',()=>{
 it('UC-A31: an audit failure must not leave an unrecorded changed review',async()=>{
  const {client,state}=fixture();
  await expect(updateCreatorReview(client,{requestId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,creatorId:'creator',status:'approved',riskLevel:'low',summary:'fixture',note:null,context})).rejects.toThrow('injected audit outage');
  expect(state.review,'status and audit must commit together').toBeNull();
 });
 it('UC-A32: retry after a failed note response must not duplicate a persisted note',async()=>{
  const {client,state}=fixture();const input={requestId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,creatorId:'creator',category:'other' as const,body:'Synthetic note',context};
  await expect(addCreatorReviewNote(client,input)).rejects.toThrow('injected audit outage');
  await expect(addCreatorReviewNote(client,input)).rejects.toThrow('injected audit outage');
  expect(state.notes.length,'same logical retry must not duplicate a note').toBeLessThanOrEqual(1);
 });
});
