import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StudioDetail } from "@/lib/studio/types";
const h=vi.hoisted(()=>({detail:null as StudioDetail|null,mutate:vi.fn(),chat:vi.fn(),invalidate:vi.fn()}));
vi.mock("@tanstack/react-router",()=>({useBlocker:()=>{},useNavigate:()=>vi.fn(),Link:({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"zh"})}));
vi.mock("@/lib/queries/kocmax",()=>({useAssistantChat:()=>({isPending:false,mutateAsync:h.chat}),useMyMissions:()=>({data:[{id:"submission",creator_workflow_mode:"active_workspace",missions:{title:"Tea"}}]})}));
vi.mock("@/lib/studio/queries",()=>({studioKeys:{detail:(id:string)=>[id]},useStudioThreads:()=>({data:{threads:[],nextPage:null}}),useStudioThread:()=>({data:h.detail}),useStudioCommand:()=>({mutateAsync:h.mutate,isPending:false})}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:h.invalidate}),useQuery:()=>({data:{workflow:{state:"drafting"},pendingReward:null,workItems:[{id:"item",title:"Reel",state:"drafting",draft:{revision:2}}]}})}));
import { StudioWorkspace } from "./StudioWorkspace";
beforeEach(()=>{
  h.chat.mockReset();
  h.mutate.mockReset();h.detail={thread:{id:"thread",title:"Tea brief",topic:"creation",mission_id:null,conversation_id:"conversation",revision:2,created_at:"2026-10-31"},sources:[{id:"private",thread_id:"thread",title:"Private note",content:"Private observation",kind:"private",shareable:false,question:"Question",platform:"manual",region:"HK",language:"zh-Hant",observed_at:"2026-10-31T00:00:00Z",url:null,revoked_at:null,status:"unverified"}],briefs:[{id:"brief",thread_id:"thread",version:1,created_at:"2026-10-31",sections:[{id:"private-section",text:"Private observation",sourceIds:["private"]},{id:"own",text:"My own idea",sourceIds:[]}]}],shares:[],messages:[]};
});
it("retains input after terminal context change and waits for a new explicit send with a fresh UUID",async()=>{
  h.chat.mockResolvedValue({persistence:"failed",code:"studio_context_changed"});
  render(<StudioWorkspace threadId="thread"/>);
  const input=screen.getByRole("textbox",{name:"繼續討論"});fireEvent.change(input,{target:{value:"Shorten option B"}});
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("上次尚未開始的要求已取消"));
  expect(input).toHaveValue("Shorten option B");expect(h.chat).toHaveBeenCalledTimes(1);
  const first=h.chat.mock.calls[0][0].client_request_id;
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  await waitFor(()=>expect(h.chat).toHaveBeenCalledTimes(2));
  expect(h.chat.mock.calls[1][0].client_request_id).not.toBe(first);
});
function prepare() {
  const view=render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("tab",{name:"Brief 與成果"}));
  fireEvent.change(screen.getByRole("combobox",{name:"選擇已接任務"}),{target:{value:"submission"}});
  fireEvent.change(screen.getByRole("combobox",{name:"選擇交付項目"}),{target:{value:"item"}});
  return view;
}
it("never transfers a private-derived paragraph even after a recipient is chosen",()=>{
  prepare();fireEvent.click(screen.getByRole("checkbox",{name:/段落 1/}));
  expect(screen.getByRole("alert")).toHaveTextContent("私人");
  expect(screen.getByRole("button",{name:"存入原任務草稿"})).toBeDisabled();expect(h.mutate).not.toHaveBeenCalled();
});
it("requires explicit confirmation and invalidates it when the loaded thread changes",()=>{
  const view=prepare();fireEvent.click(screen.getByRole("checkbox",{name:/段落 2/}));
  const submit=screen.getByRole("button",{name:"存入原任務草稿"});expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:/我已檢查所選內容/}));expect(submit).toBeEnabled();expect(h.mutate).not.toHaveBeenCalled();
  h.detail={...h.detail!,thread:{...h.detail!.thread,revision:3}};view.rerender(<StudioWorkspace threadId="thread"/>);
  expect(submit).toBeDisabled();expect(h.mutate).not.toHaveBeenCalled();
});
it("invalidates sharing when the saved brief is edited",()=>{
  prepare();fireEvent.click(screen.getByRole("checkbox",{name:/段落 2/}));fireEvent.click(screen.getByRole("checkbox",{name:/我已檢查所選內容/}));
  fireEvent.change(screen.getByRole("textbox",{name:"段落 2"}),{target:{value:"Changed idea"}});
  expect(screen.getByRole("button",{name:"存入原任務草稿"})).toBeDisabled();expect(h.mutate).not.toHaveBeenCalled();
});
