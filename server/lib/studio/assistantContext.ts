import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioAssistantContext } from "../assistant/chat.js";
import type { ChatMessage } from "../llm.js";

/** Private data comes from the owner-scoped service read; mission access still uses user RLS.
 * A new evidence basis excludes all prior derived replies, even requests finishing after revocation. */
export async function loadStudioContext(store: Pick<SupabaseClient,"from">, user: Pick<SupabaseClient,"from">, creator: string, workspace: string, conversation: string) {
  const thread = await store.from("studio_threads").select("id,title,topic,mission_id")
    .eq("conversation_id",conversation).eq("creator_id",creator).eq("workspace_id",workspace).maybeSingle();
  if(thread.error) throw new Error("studio_unavailable");
  if(!thread.data) return undefined;
  const sources=await store.from("studio_sources").select("id,title,content,status,question,platform,observed_at,revoked_at")
    .eq("thread_id",thread.data.id).eq("creator_id",creator).eq("workspace_id",workspace).order("created_at",{ascending:false}).limit(100);
  if(sources.error) throw new Error("studio_unavailable");
  const mission=thread.data.mission_id ? await user.from("missions").select("id,title,description,platforms,deliverables,deadline,requirements,dos,donts,key_messages")
    .eq("id",thread.data.mission_id).eq("workspace_id",workspace).maybeSingle() : {data:null,error:null};
  if(mission.error) throw new Error("studio_unavailable");
  // Bound unusually large authoring fields and explicitly mark truncation; never turn it into a complete-rule claim.
  const missionData=mission.data ? Object.fromEntries(Object.entries(mission.data).map(([key,value])=>{
    const serialized=JSON.stringify(value);return [key,serialized && serialized.length>8000 ? {excerpt:serialized.slice(0,8000),truncated:true}:value];
  })) as StudioAssistantContext["mission"] : null;
  const context:StudioAssistantContext={title:thread.data.title,topic:thread.data.topic,mission:missionData,
    sources:(sources.data??[]).filter(s=>!s.revoked_at).slice(0,12)};
  // Keep within the existing 80-character reservation contract. Immutable source IDs and
  // revocation markers prevent an old context hash from reappearing after a source is removed.
  const contextVersion="studio:"+createHash("sha256").update(JSON.stringify({thread:thread.data.id,mission:mission.data,
    sources:(sources.data??[]).map(s=>[s.id,s.revoked_at]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))})).digest("hex");
  const prior=await user.from("assistant_requests").select("message,result")
    .eq("creator_id",creator).eq("workspace_id",workspace).eq("conversation_id",conversation)
    .eq("context_version",contextVersion).eq("state","saved").order("created_at",{ascending:false}).limit(10);
  if(prior.error) throw new Error("history_unavailable");
  const history:ChatMessage[]=(prior.data??[]).reverse().flatMap(r=>typeof r.result?.answer==="string"
    ? [{role:"user" as const,content:r.message},{role:"assistant" as const,content:r.result.answer}]:[]);
  return {context,contextVersion,history};
}
