import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
const h=vi.hoisted(()=>({session:vi.fn(),callback:null as null | (()=>void)}));
vi.mock("@/lib/supabase",()=>({supabase:{auth:{getSession:h.session,onAuthStateChange:(callback:()=>void)=>{
  h.callback=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};}}}}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"en",t:(key:string)=>key})}));
import { StaffAuthGate } from "./StaffAuthGate";
beforeEach(()=>{vi.clearAllMocks();h.callback=null;});
afterEach(()=>{vi.unstubAllGlobals();});
it("discards a late response body after sign-out and clears identity-owned caches",async()=>{
  let resolveBody!:(value:unknown)=>void;
  const body=new Promise((resolve)=>resolveBody=resolve);
  const fetch=vi.fn(async()=>({status:200,json:()=>body}));vi.stubGlobal("fetch",fetch);
  h.session.mockResolvedValueOnce({data:{session:{access_token:"synthetic"}},error:null})
    .mockResolvedValue({data:{session:null},error:null});
  const changed=vi.fn();render(<StaffAuthGate onIdentityChange={changed}>{(staff)=><p>Private {staff.userId}</p>}</StaffAuthGate>);
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
  await act(async()=>{h.callback!();});expect(changed).toHaveBeenCalledTimes(1);
  await act(async()=>{resolveBody({staff:{userId:"old-staff",email:"synthetic@example.test",active:true}});});
  expect(screen.queryByText("Private old-staff")).not.toBeInTheDocument();
});
