import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const h=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock("@/lib/admin",()=>({fetchCreatorReviewQueue:h.fetch,AdminAuthError:class extends Error{}}));
vi.mock("@/components/admin/AdminAuthContext",()=>({useAdminAuth:()=>({authed:true,reportAuthError:vi.fn()})}));
vi.mock("@/components/admin/AdminWorkspaceContext",()=>({useAdminWorkspace:()=>({workspace:"workspace-a"})}));
vi.mock("@/components/operator/CreatorReviewRow",()=>({CreatorReviewRow:({creator}:{creator:{id:string;displayName:string}})=><a href="#detail" data-creator-id={creator.id}>{creator.displayName}</a>}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({t:(key:string)=>key})}));
vi.mock("@tanstack/react-router",()=>({createFileRoute:()=>(options:unknown)=>({options,useSearch:()=>({})})}));
import { Route } from "./admin.creators";
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();window.history.replaceState(null,"","/admin/creators");});
async function refetchFailure(status:number){
  h.fetch.mockResolvedValueOnce({creators:[{id:"a",displayName:"Previously authorized creator"}],page:1,pageSize:25,total:1})
    .mockRejectedValue(Object.assign(new Error("read failed"),{status}));
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}}); const C=Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={qc}><C/></QueryClientProvider>); await screen.findByText("Previously authorized creator");
  await act(async()=>{await qc.refetchQueries();}); await waitFor(()=>expect(screen.getByRole("alert")).toBeInTheDocument());
}
it("removes cached rows immediately when refetch revokes workspace access",async()=>{
  await refetchFailure(403); expect(screen.queryByText("Previously authorized creator")).not.toBeInTheDocument();
});
it("retains the previous rows with a stale warning during a temporary outage",async()=>{
  await refetchFailure(503); expect(screen.getByText("Previously authorized creator")).toBeInTheDocument();
  expect(screen.getByText(/Showing the previous saved data/)).toBeInTheDocument();
});
it("restores the selected creator focus and scroll after returning to the same queue",async()=>{
  const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
  sessionStorage.setItem("adfocate-queue-focus","a");
  sessionStorage.setItem("adfocate-queue-scroll","340");
  h.fetch.mockResolvedValue({creators:[{id:"a",displayName:"Return to this creator"}],page:1,pageSize:25,total:1});
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}}); const C=Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={qc}><C/></QueryClientProvider>);
  const row=await screen.findByText("Return to this creator");
  await waitFor(()=>expect(row).toHaveFocus());
  expect(scroll).toHaveBeenCalledWith({top:340,behavior:"instant"});
  expect(sessionStorage.getItem("adfocate-queue-focus")).toBeNull();
  scroll.mockRestore();
});
