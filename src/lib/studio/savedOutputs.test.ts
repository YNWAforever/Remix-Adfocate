import { expect, it } from "vitest";
import { copySavedBrief, inspectSavedBrief } from "./savedOutputs";
import type { StudioBrief, StudioSource } from "./types";

const source: StudioSource = { id:"source",thread_id:"thread",title:"Private",content:"Private note",url:null,kind:"private",shareable:false,question:"Why",platform:"manual",region:null,language:null,observed_at:"2026-11-05",revoked_at:null,status:"unverified" };
const brief: StudioBrief = {id:"brief",thread_id:"thread",version:1,created_at:"2026-11-05",sections:[{id:"section",text:"Private derived idea",sourceIds:["source"]},{id:"own",text:"My idea",sourceIds:[]}]};
it("copies private usable sources with independent arrays and fresh ids without escalating rights",()=>{
  let n=0; const before=JSON.stringify({brief,source});
  const copy=copySavedBrief(brief,"thread",[source],()=>`copy-${++n}`);
  expect(copy.map(s=>s.id)).toEqual(["copy-1","copy-2"]);
  expect(copy[0].sourceIds).toEqual(["source"]);expect(copy[0].sourceIds).not.toBe(brief.sections[0].sourceIds);
  expect(JSON.stringify({brief,source})).toBe(before);expect(source.shareable).toBe(false);
});
it.each([[],[{...source,revoked_at:"2026-11-05"}],[{...source,thread_id:"other"}],[source,source]].map(sources=>({sources})))("blocks unavailable or ambiguous lineage and redacts only affected sections: %j",({sources})=>{
  const result=inspectSavedBrief(brief,"thread",sources);
  expect(result.copyable).toBe(false);expect(result.unavailableSourceIds).toEqual(["source"]);
  expect(result.sections.map(s=>s.text)).toEqual([null,"My idea"]);
  expect(()=>copySavedBrief(brief,"thread",sources,()=>"new")).toThrow("BRIEF_UNAVAILABLE");
});
it("redacts every section of a foreign brief including source-free content",()=>{
  expect(inspectSavedBrief(brief,"other",[source]).sections.every(s=>s.text===null)).toBe(true);
});
it.each([[],[{id:"a",text:" ",sourceIds:[]}],[{id:"a",text:"x".repeat(3001),sourceIds:[]}],Array.from({length:13},(_,i)=>({id:String(i),text:"ok",sourceIds:[]})),[{id:"same",text:"ok",sourceIds:[]},{id:"same",text:"ok",sourceIds:[]}]].map(sections=>({sections})))("rejects invalid sections: %j",({sections})=>{
  expect(()=>copySavedBrief({...brief,sections},"thread",[source],()=>"new")).toThrow("BRIEF_UNAVAILABLE");
});
it.each(["section","","same"])("rejects invalid generated ids: %s",id=>{
  expect(()=>copySavedBrief(brief,"thread",[source],()=>id)).toThrow("BRIEF_UNAVAILABLE");
});

