// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStudioContext } from "../lib/studio/assistantContext.js";
import { runAssistant } from "../lib/assistant/chat.js";
import { authorizeStudioCommand, redactRevokedIntegrationOutputs } from "../lib/integrations/evidence.js";
import type { StudioSource } from "../../src/lib/studio/types.js";

const source:StudioSource={id:"provider-source",thread_id:"thread",title:"Private file",content:"PRIVATE FILE BODY",url:null,kind:"private",shareable:false,question:"actual question",platform:"Google Drive mock",region:null,language:null,observed_at:"2026-10-31T10:00:00Z",revoked_at:null,status:"unverified",integration:{connection_id:"connection",snapshot_id:"snapshot",resource_id:"resource",generation:1,source_version:"v1",content_hash:"hash",model_allowed:false,provenance:"google_drive",availability:"available",sample_only:true,coverage:{region:null,language:null,partial:false}}};
function client(rows:Record<string,unknown>,reads:Array<{table:string;filters:Record<string,unknown>}>=[]) {
  return {from(table:string){const read={table,filters:{} as Record<string,unknown>};reads.push(read);const q={select:()=>q,eq:(key:string,value:unknown)=>{read.filters[key]=value;return q;},order:()=>q,limit:()=>q,maybeSingle:()=>q,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:rows[table]??[],error:null}).then(resolve)};return q;}} as unknown as Parameters<typeof loadStudioContext>[0];
}
afterEach(()=>vi.unstubAllEnvs());
describe("studio uses integration evidence with explicit consent",()=>{
  it("excludes unconsented private provider data and its old history from the model context",async()=>{
    const rows={studio_threads:{id:"thread",title:"Tea",topic:"creation",mission_id:null},studio_sources:[source],assistant_requests:[]};
    const loaded=await loadStudioContext(client(rows),client(rows),"creator","workspace","conversation");
    expect(loaded!.context.sources).toEqual([]);expect(JSON.stringify(loaded!.context)).not.toContain(source.content);
  });
  it("uses an offline assistant for mock-derived sources without contacting any external model",async()=>{
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("external not allowed"));
    try {
      const response=await runAssistant({} as Parameters<typeof runAssistant>[0],{query:"brief",locale:"zh",workspace:"workspace",history:[],studioContext:{title:"Tea",topic:"creation",sources:[{...source,integration:{...source.integration!,model_allowed:true}}]}});
      expect(response.limitations).toContain("mock_provider_data");expect(response.answer).toContain("模擬");expect(response.citations[0].sourceType).toBe("integration_mock_unverified");expect(network).not.toHaveBeenCalled();
    } finally {network.mockRestore();}
  });
  it("resolves sources from the saved brief, so a forged client source list cannot bypass a disabled provider",async()=>{
    const reads:Array<{table:string;filters:Record<string,unknown>}>=[];
    const store=client({studio_briefs:{sections:[{id:"one",text:"derived",sourceIds:[source.id]}]},studio_sources:[source]},reads);
    await expect(authorizeStudioCommand(store,{creatorId:"creator",workspaceId:"workspace"},"share_brief",{briefId:"brief",threadId:"thread",sectionIds:["one"],sourceIds:[]})).rejects.toThrow("INTEGRATIONS_DISABLED");
    expect(reads.every(read=>read.filters.creator_id==="creator"&&read.filters.workspace_id==="workspace")).toBe(true);
  });
  it("redacts revoked derivatives and chat while keeping unrelated original sections",()=>{
    const detail=redactRevokedIntegrationOutputs({sources:[{...source,revoked_at:"2026-10-31T11:00:00Z"}],briefs:[{sections:[{id:"derived",text:"PRIVATE FILE BODY",sourceIds:[source.id]},{id:"own",text:"my own words",sourceIds:[]}]}],messages:[{content:"PRIVATE FILE BODY"}]});
    expect(JSON.stringify(detail)).not.toContain("PRIVATE FILE BODY");expect(detail.briefs[0].sections[1].text).toBe("my own words");expect(detail.messages).toEqual([]);
  });
  it("retains user input and new safe replies after source revocation",()=>{
    const messages=[{role:"user",content:"my original request",created_at:"2026-10-31T10:59:00Z"},{role:"assistant",content:"PRIVATE FILE BODY",created_at:"2026-10-31T10:59:01Z"},{role:"user",content:"continue without that source",created_at:"2026-10-31T11:01:00Z"},{role:"assistant",content:"new safe reply",created_at:"2026-10-31T11:01:01Z"}];
    const result=redactRevokedIntegrationOutputs({sources:[{...source,revoked_at:"2026-10-31T11:00:00Z"}],briefs:[],messages});
    expect(result.messages).toEqual([messages[0],messages[2],messages[3]]);
  });
});
