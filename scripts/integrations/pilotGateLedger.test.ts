// @vitest-environment node
import {expect,it} from 'vitest';
import {buildP5GateLedger,defaultP5Gates,evaluateP5Gates,renderGateLedger,type GateRecord} from './pilotGateLedger.js';

const ready=(overrides:Partial<GateRecord>={}):GateRecord=>({
 id:'B1',title:'Offline boundary',owner:'engineer',state:'OFFLINE_PROVEN',liveRequired:false,evidenceRefs:['review/offline.md'],requiredInputs:[],actionScope:'none',invalidation:'candidate change',reason:null,expiresAt:null,...overrides,
});
it('keeps the current incomplete P5 candidate on HOLD',()=>{
 const gates=defaultP5Gates();const result=evaluateP5Gates(gates,new Date('2026-11-07T00:00:00Z').getTime());
 expect(result.status).toBe('HOLD_WITH_BLOCKERS');expect(result.executionAllowed).toBe(false);expect(result.blockers.length).toBeGreaterThan(0);
 expect(gates.find(gate=>gate.id==='B2')).toMatchObject({state:'NOT_APPLICABLE',liveRequired:false,actionScope:'D'});
 const {ledger}=buildP5GateLedger('a'.repeat(64),'b'.repeat(64),'VERIFIED');
 const markdown=renderGateLedger(ledger);
 expect(markdown).toContain('HOLD_WITH_BLOCKERS');expect(markdown).toContain('B10');
 expect(markdown).toContain('Offline verification: **VERIFIED**');
 expect(ledger.gates).toEqual(gates);
});
it('exposes missing and blocked offline verification as separate blockers',()=>{
 expect(buildP5GateLedger(null,null,'NOT_RUN').blockers).toContain('offline_evidence:not_run');
 const failed=buildP5GateLedger('a'.repeat(64),'b'.repeat(64),'BLOCKED');
 expect(failed.ledger).toMatchObject({status:'HOLD_WITH_BLOCKERS',offlineVerification:'BLOCKED',executionAllowed:false});
 expect(failed.blockers).toContain('offline_evidence:blocked');
});
it('never allows a live-required gate to be closed by offline evidence',()=>{
 const gates=defaultP5Gates();gates[0]={...gates[0],state:'OFFLINE_PROVEN',liveRequired:true,evidenceRefs:['mock.md']};
 const result=evaluateP5Gates(gates,Date.now());expect(result.status).toBe('HOLD_WITH_BLOCKERS');expect(result.blockers).toContain('gate:B1:live_requires_live_state');
});
it('distinguishes owner input from user approval readiness',()=>{
 const owner=defaultP5Gates().map(gate=>({...gate,state:'OWNER_INPUT_REQUIRED' as const,requiredInputs:['value'],liveRequired:true}));
 expect(evaluateP5Gates(owner,Date.now()).status).toBe('READY_FOR_OWNER_INPUT');
 const ready=defaultP5Gates().map(gate=>({...gate,state:gate.id==='B10'?'LIVE_TEST_REQUIRED_AFTER_APPROVAL' as const:'LIVE_TEST_REQUIRED_AFTER_APPROVAL' as const,liveRequired:true,requiredInputs:[]}));
 expect(evaluateP5Gates(ready,Date.now())).toEqual({status:'READY_FOR_USER_APPROVAL',blockers:[],executionAllowed:false});
});
it('requires reasons, evidence and unique B1-B10 ids',()=>{
 expect(evaluateP5Gates([ready({state:'NOT_APPLICABLE',reason:null}),...defaultP5Gates().slice(1)],Date.now()).blockers).toContain('gate:B1:not_applicable_reason');
 expect(evaluateP5Gates([ready({evidenceRefs:[]}),...defaultP5Gates().slice(1)],Date.now()).blockers).toContain('gate:B1:offline_evidence');
 expect(evaluateP5Gates(defaultP5Gates().slice(1),Date.now()).blockers).toContain('gate:B1:missing');
 expect(evaluateP5Gates([ready(),ready(),...defaultP5Gates().slice(2)],Date.now()).blockers).toContain('gate:B1:duplicate');
});
it('blocks expired evidence and unknown states',()=>{
 const expired=defaultP5Gates();expired[0]={...expired[0],expiresAt:'2026-01-01T00:00:00Z'};
 expect(evaluateP5Gates(expired,Date.parse('2026-11-07T00:00:00Z')).blockers).toContain('gate:B1:expired');
 const unknown=defaultP5Gates();unknown[0]={...unknown[0],state:'PASS' as never};
 expect(evaluateP5Gates(unknown,Date.now()).blockers).toContain('gate:B1:state');
});
