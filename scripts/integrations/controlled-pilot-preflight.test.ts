// @vitest-environment node
import {expect,it} from "vitest";
import {validateControlledPilotPacket} from "./controlled-pilot-preflight";
it("never grants execution and rejects incomplete or invented readiness",()=>{
 for(const packet of [undefined,{ready:true},{version:1,mode:"review_only",evidence:{},hashes:{},observedHashes:{}}]){const r=validateControlledPilotPacket(packet);expect(r.readyForReview).toBe(false);expect(r.executionAllowed).toBe(false);expect(r.blockers.length).toBeGreaterThan(0);}
});
it("requires matching exact artifacts, all evidence and no unknown outcomes",()=>{
 const evidence=Object.fromEntries(["app","protocol","identity","label","revoke","environment","callback","worker","secretStorage","costs","owner","operator","reviewer","window","limits","retention","restore","cleanup","firstPost"].map(k=>[k,"review/verified.md"]));
 const hashes=Object.fromEntries(["sql","rollback","jpeg","caption","disclosure","roster"].map(k=>[k,"a".repeat(64)]));
 const p={version:1,mode:"review_only",evidence,hashes,observedHashes:hashes,unknownOutcomes:0};
 expect(validateControlledPilotPacket(p)).toMatchObject({readyForReview:true,executionAllowed:false});
 for(const patch of [{evidence:{...evidence,restore:null}},{observedHashes:{...hashes,jpeg:"b".repeat(64)}},{unknownOutcomes:1}])expect(validateControlledPilotPacket({...p,...patch}).readyForReview).toBe(false);
});
