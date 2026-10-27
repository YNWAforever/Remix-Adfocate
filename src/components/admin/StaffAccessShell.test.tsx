import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const h=vi.hoisted(()=>({access:vi.fn(),apps:vi.fn(),subs:vi.fn(),workspaces:vi.fn()}));
vi.mock("@/lib/admin",async original=>({...await original<object>(),fetchStaffAccess:h.access,fetchApplications:h.apps,fetchSubmissions:h.subs,fetchWorkspaces:h.workspaces}));
vi.mock("@/lib/supabase",()=>({supabase:{auth:{signOut:vi.fn(),getSession:async()=>({data:{session:null}})}}}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({t:(key:string)=>key,lang:"en",localeReady:true})}));
vi.mock("@tanstack/react-router",()=>({useLocation:()=>({pathname:"/admin/reward-handoffs"}),Link:({to,children,onClick}:{to:string;children:ReactNode;onClick?:()=>void})=><a href={to} onClick={onClick}>{children}</a>}));
vi.mock("./AdminWorkspaceContext",()=>({useAdminWorkspace:()=>({workspace:"owned",workspaceSlug:"owned",setWorkspace:vi.fn()})}));
import {AdminShell} from "./AdminShell";
import {AdminAuthContext} from "./AdminAuthContext";
import {RewardHandoffQueue} from "./RewardHandoffQueue";
import {ReviewActionPanel} from "../operator/ReviewActionPanel";
const finance={workspace:{id:"owned",slug:"owned",role:"finance_viewer",capabilities:["reward.read"],revision:1},platformCapabilities:[],scopeStatus:null};
function show(children:ReactNode=<input aria-label="Retained draft" defaultValue="Draft text" />){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><AdminAuthContext.Provider value={{authed:true,staff:{userId:"staff",email:"owned@example.invalid"},reportAuthError:vi.fn()}}><AdminShell>{children}</AdminShell></AdminAuthContext.Provider></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();h.access.mockResolvedValue({access:finance});h.apps.mockResolvedValue({applications:[]});h.subs.mockResolvedValue({submissions:[]});h.workspaces.mockResolvedValue({workspaces:[{id:"owned",slug:"owned",name:"Owned workspace"}]});});
it("D18 finance navigation exposes handoffs and does not prefetch review queues",async()=>{
 show();await screen.findByLabelText("Staff role");expect(screen.getByRole("link",{name:"app.admin.tabRewardHandoffs"})).toBeVisible();
 expect(screen.queryByRole("link",{name:"app.admin.tabAcademy"})).not.toBeInTheDocument();expect(screen.queryByRole("link",{name:"app.admin.tabMissions"})).not.toBeInTheDocument();
 expect(h.apps).not.toHaveBeenCalled();expect(h.subs).not.toHaveBeenCalled();
});
it("D18 platform-only editor has editorial navigation without a workspace request or re-login prompt",async()=>{
 h.access.mockResolvedValue({access:{workspace:null,platformCapabilities:["content.manage"],scopeStatus:"WORKSPACE_MEMBERSHIP_REQUIRED"}});show();
 await screen.findByText(/Platform content/);expect(screen.getByRole("link",{name:"app.admin.tabAcademy"})).toBeVisible();expect(screen.queryByRole("link",{name:"app.admin.tabRewardHandoffs"})).not.toBeInTheDocument();expect(h.workspaces).not.toHaveBeenCalled();
});
it("D18 failed access discovery is announced and retry keeps an existing draft",async()=>{
 h.access.mockRejectedValueOnce(new Error("Access service unavailable"));show();fireEvent.change(screen.getByLabelText("Retained draft"),{target:{value:"Unsent draft remains"}});
 await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:/Retry access/}));await waitFor(()=>expect(h.access).toHaveBeenCalledTimes(2));await screen.findByLabelText("Staff role");expect(screen.getByLabelText("Retained draft")).toHaveValue("Unsent draft remains");
});
it("D18 finance handoff view does not offer a processing-window mutation",async()=>{
 show(<RewardHandoffQueue workspaceKey="owned" items={[]} filters={{status:"pending"}} processingWindowDays={7} onFiltersChange={vi.fn()} onSaveProcessingWindow={vi.fn()}/>);
 await screen.findByLabelText("Staff role");expect(screen.queryByRole("button",{name:"app.admin.rewardHandoff.sla.save"})).not.toBeInTheDocument();
});
it("D18 a reviewer can read a Creator without an approve or note editor",async()=>{
 h.access.mockResolvedValue({access:{...finance,workspace:{...finance.workspace,role:"reviewer",capabilities:["creator.read","submission.review","proof.review"]}}});
 show(<ReviewActionPanel creator={{id:"creator",displayName:"Owned creator",review:{status:"needs_review",riskLevel:"unknown",summary:null,reviewedBy:null,lastReviewedAt:null,updatedAt:null}}}/>);
 await screen.findByLabelText("Staff role");expect(screen.queryByRole("button",{name:"Approve Owned creator"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Flag Owned creator"})).not.toBeInTheDocument();
});

it("D18 finance handoff keeps saved decision information without offering a forbidden workflow link",async()=>{
 const item={id:"reward",workflowId:"workflow",submissionId:"submission",creatorId:"creator",missionId:"mission",rewardContractId:"contract",completionDecisionId:"decision",cancellationDecisionId:null,reward:{pointsAmount:10,cashAmount:0,currency:"HKD",xpAmount:0},status:"pending" as const,processingWindowDays:7,targetAt:null,createdAt:"2026-10-23T10:00:00Z",cancelledAt:null,decision:null,creatorDisplayName:"Owned creator",missionTitle:"Owned mission",completionDecision:{id:"decision",kind:"approved" as const,decidedAt:"2026-10-23T10:00:00Z",requiredItemCount:1,verifiedRequiredItemCount:1,evidenceAvailable:true}};
 show(<RewardHandoffQueue workspaceKey="owned" items={[item]} filters={{status:"pending"}} processingWindowDays={7} onFiltersChange={vi.fn()} onSaveProcessingWindow={vi.fn()}/>);
 await screen.findByLabelText("Staff role");expect(screen.getAllByText("Owned mission").length).toBeGreaterThan(0);expect(screen.queryAllByRole("link",{name:"app.admin.rewardHandoff.timeline"})).toHaveLength(0);
});
