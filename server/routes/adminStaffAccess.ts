import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { requireStaffWorkspace, StaffWorkspaceError } from "../lib/staffWorkspace.js";
import { readWorkspaceAccess, readPlatformCapabilities, ROLE_CAPABILITIES, StaffCapabilityError } from "../lib/staffCapabilities.js";

export const adminStaffAccessRoutes = new Hono<AdminEnv>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

adminStaffAccessRoutes.get("/access", async c => {
  try {
    const client=serviceClient(),staff=c.get("staff"),platformCapabilities=await readPlatformCapabilities(client,staff);
    let workspace=null,scopeStatus:string|null=null;
    try {
      const requested=c.req.query("workspace")||c.req.query("ws")||c.req.header("X-Workspace-Slug")||"";
      const scope=await requireStaffWorkspace(client,staff,requested);
      for(const value of [c.req.query("workspace"),c.req.query("ws"),c.req.header("X-Workspace-Slug")])if(value&&value!==scope.workspaceId&&value!==scope.workspaceSlug)throw new StaffWorkspaceError("NOT_FOUND",404);
      const role=await readWorkspaceAccess(client,scope);
      workspace={id:scope.workspaceId,slug:scope.workspaceSlug,role:role?.role??null,capabilities:role?.capabilities??[],revision:role?.revision??null};
    } catch(error) {
      if(error instanceof StaffWorkspaceError&&error.code==="WORKSPACE_MEMBERSHIP_REQUIRED")scopeStatus=error.code;
      else throw error;
    }
    return c.json({access:{workspace,platformCapabilities,scopeStatus}});
  } catch(error) {
    if(error instanceof StaffWorkspaceError||error instanceof StaffCapabilityError)return c.json({code:error.code,error:error.status===503?"Staff access is unavailable; retry after the access schema/service is checked.":"The requested workspace is unavailable. Check workspace access; signing in again does not assign a role."},error.status);
    return c.json({code:"STAFF_CAPABILITY_UNAVAILABLE",error:"Staff access could not be checked. Please retry."},503);
  }
});

adminStaffAccessRoutes.get("/staff-access",async c=>{
  const scope=c.get("authorizedWorkspace"),client=serviceClient();
  const [grants,audit]=await Promise.all([
    client.from("staff_workspace_roles").select("user_id,workspace_id,role,active,revision,granted_by,granted_at",{count:"exact"}).eq("workspace_id",scope.workspaceId).order("user_id").limit(1000),
    client.from("staff_access_audit").select("id,request_id,user_id,actor_id,actor_kind,before_state,after_state,reason,created_at").eq("workspace_id",scope.workspaceId).order("created_at",{ascending:false}).limit(50),
  ]);
  if(grants.error||audit.error)return c.json({code:"STAFF_CAPABILITY_UNAVAILABLE",error:"Access records could not be loaded. Please retry."},503);
  return c.json({grants:grants.data,audit:audit.data,total:grants.count,hasMore:(grants.count??0)>(grants.data?.length??0),auditLimit:50});
});

adminStaffAccessRoutes.put("/staff-access/:userId",async c=>{
  const scope=c.get("authorizedWorkspace"),target=c.req.param("userId");
  const body=await c.req.json<Record<string,unknown>>().catch(()=>({} as Record<string,unknown>));
  if(!uuid.test(target)||typeof body.role!=="string"||!Object.hasOwn(ROLE_CAPABILITIES,body.role)||typeof body.active!=="boolean"||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0||typeof body.requestId!=="string"||!uuid.test(body.requestId)||typeof body.reason!=="string"||!body.reason.trim()||body.reason.length>500)return c.json({code:"STAFF_ACCESS_INVALID",error:"Choose an assigned role, active state, request ID, current revision and a reason (1–500 characters)."},422);
  if(target===scope.userId)return c.json({code:"STAFF_SELF_CHANGE_FORBIDDEN",error:"Self changes require a separate owner review."},403);
  const result=await serviceClient().rpc("set_staff_workspace_role",{p_workspace:scope.workspaceId,p_actor:scope.userId,p_subject:target,p_role:body.role,p_active:body.active,p_expected_revision:body.expectedRevision,p_request:body.requestId,p_reason:body.reason.trim()});
  if(result.error){
    const code=result.error.message;
    if(["STAFF_ACCESS_STALE","STAFF_ACCESS_IDEMPOTENCY_CONFLICT"].includes(code))return c.json({code,error:"Access changed. Reload, compare your retained input and use the current revision."},409);
    if(code==="STAFF_TARGET_NOT_ELIGIBLE")return c.json({code,error:"Target is not found or eligible in this workspace."},404);
    if(["STAFF_ACCESS_FORBIDDEN","STAFF_SELF_CHANGE_FORBIDDEN"].includes(code))return c.json({code,error:"This role change is not permitted. Ask the owner to review access."},403);
    return c.json({code:"STAFF_ACCESS_UNAVAILABLE",error:"Role change could not be confirmed. Retain the input and retry with the same request ID."},503);
  }
  return c.json({grant:result.data});
});
