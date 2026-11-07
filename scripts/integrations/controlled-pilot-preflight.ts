/** Pure review-packet check. No CLI execution, credentials, transport or authority. */
export function validateControlledPilotPacket(packet:unknown):{readyForReview:boolean;blockers:string[];executionAllowed:false}{
 const blockers:string[]=[];
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
 if(!object(packet))return {readyForReview:false,blockers:["packet_missing"],executionAllowed:false};
 if(packet.version!==1||packet.mode!=="review_only"||Object.keys(packet).some(k=>!["version","mode","evidence","hashes","observedHashes","unknownOutcomes"].includes(k)))blockers.push("packet_contract");
 for(const key of ["app","protocol","identity","label","revoke","environment","callback","worker","secretStorage","costs","owner","operator","reviewer","window","limits","retention","restore","cleanup","firstPost"]){const ref=object(packet.evidence)?packet.evidence[key]:null;if(typeof ref!=="string"||!/^review\/[a-zA-Z0-9_./-]+\.md$/.test(ref)||ref.includes(".."))blockers.push(`evidence:${key}`);}
 for(const key of ["sql","rollback","jpeg","caption","disclosure","roster"]){const hash=object(packet.hashes)?packet.hashes[key]:null,observed=object(packet.observedHashes)?packet.observedHashes[key]:null;if(typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash)||hash!==observed)blockers.push(`hash:${key}`);}
 if(packet.unknownOutcomes!==0)blockers.push("unknown_outcomes");
 return {readyForReview:blockers.length===0,blockers,executionAllowed:false};
}
