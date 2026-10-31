// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const calls=vi.hoisted(()=>({chat:vi.fn(),embed:vi.fn()}));
vi.mock("../lib/llm.js",()=>({chatComplete:calls.chat,embedTexts:calls.embed}));
import { runAssistant, liveProvider, type StudioAssistantContext } from "../lib/assistant/chat.js";
const context=(sampleOnly:boolean):StudioAssistantContext=>({title:"私人試點",topic:"creation",sources:[{id:"source",title:"私人文件",content:"不可外送的測試內容",status:"unverified",integration:{connection_id:"c",snapshot_id:"s",resource_id:"r",generation:1,source_version:"1",content_hash:"hash",model_allowed:true,provenance:"google_drive",availability:"available",sample_only:sampleOnly,coverage:{region:null,language:null,partial:false}}}]});
beforeEach(()=>{calls.chat.mockReset();calls.embed.mockReset();calls.chat.mockResolvedValue({content:"unexpected network result",toolCalls:[]});});
it.each([true,false])("D0 never sends provider-derived data to the default or explicitly supplied live AI (sample=%s)",async sample=>{
  const input={query:"整理",locale:"zh",workspace:"w",history:[],studioContext:context(sample)};
  for(const deps of [{},{provider:liveProvider}]) {
    const result=await runAssistant({} as Parameters<typeof runAssistant>[0],input,deps);
    expect(result.limitations).toContain("external_model_not_approved");
    expect(result.answer).not.toBe("unexpected network result");
    if(!sample) expect(result.citations[0].sourceType).toBe("integration_provider_unverified");
  }
  expect(calls.chat).not.toHaveBeenCalled();expect(calls.embed).not.toHaveBeenCalled();
});
