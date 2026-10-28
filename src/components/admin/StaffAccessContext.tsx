import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStaffAccess, type StaffAccessSnapshot, type StaffCapability } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

type AccessContext = {access:StaffAccessSnapshot|undefined;loading:boolean;error:unknown;refresh:()=>Promise<unknown>;can:(capability:StaffCapability|"content.manage")=>boolean};
const Context=createContext<AccessContext|undefined>(undefined);
export function useStaffAccess(){return useContext(Context);}
export function StaffAccessProvider({children}:{children:ReactNode}){
 const {authed,staff}=useAdminAuth(),{workspace}=useAdminWorkspace(),client=useQueryClient();
 const query=useQuery({queryKey:["admin-access",staff?.userId,workspace],queryFn:()=>fetchStaffAccess(workspace),enabled:authed,retry:false,staleTime:0,refetchOnWindowFocus:"always"});
 const {refetch}=query;
 const access=query.isError?undefined:query.data?.access;
 const previous=useRef<string|undefined>(undefined),fingerprint=JSON.stringify(access);
 useEffect(()=>{
  if(previous.current!==undefined&&previous.current!==fingerprint)void client.invalidateQueries({predicate:q=>q.queryKey[0]!=="admin-access"&&/^(admin|operator)/.test(String(q.queryKey[0]))});
  previous.current=fingerprint;
 },[fingerprint,client]);
 useEffect(()=>{const refresh=()=>{void refetch();};window.addEventListener("adfocate:staff-access-denied",refresh);return()=>window.removeEventListener("adfocate:staff-access-denied",refresh);},[refetch]);
 const value=useMemo<AccessContext>(()=>({access,loading:query.isPending,error:query.error,refresh:query.refetch,can:cap=>cap==="content.manage"?Boolean(access?.platformCapabilities.includes(cap)):Boolean(access?.workspace?.capabilities.includes(cap))}),[access,query.isPending,query.error,query.refetch]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Presentation derives from server-issued capabilities, never from brand/JWT role claims. */
export function canOpenStaffPage(access:AccessContext|undefined,path:string){
 if(!access)return true; // Leaf previews outside the shell; API authorization is always enforced.
 if(path.startsWith("/admin/academy")||path.startsWith("/admin/content"))return access.can("content.manage");
 if(path.startsWith("/admin/reward-handoffs"))return access.can("reward.read");
 if(path.startsWith("/admin/staff-access"))return access.can("access.manage");
 if(path.startsWith("/admin/active-missions"))return ["submission.review","proof.review","completion.approve"].some(c=>access.can(c as StaffCapability));
 if(path.startsWith("/admin/applications"))return access.can("application.review");
 if(path.startsWith("/admin/submissions"))return access.can("submission.review");
 if(path.startsWith("/admin/missions")||path.startsWith("/admin/campaigns"))return access.can("mission.manage");
 return access.can("creator.read");
}
