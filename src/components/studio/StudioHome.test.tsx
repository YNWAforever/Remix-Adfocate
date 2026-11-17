import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
const LEVEL_LABELS: Record<string, string> = {
  "app.level.l0": "訪客",
  "app.level.l1": "KOC 新手",
  "app.level.l2": "KOC 見習",
  "app.level.l3": "KOC 成長",
  "app.level.l4": "KOC 進階",
  "app.level.l5": "KOC 專業",
  "app.level.l6": "KOC 大師",
};
const h=vi.hoisted(()=>({meError:null as Error|null,balanceError:null as Error|null,historyError:null as Error|null,enabled:true,mutate:vi.fn(),navigate:vi.fn(),historyOptions:vi.fn(),lang:"zh",track:[] as Array<[string,unknown]>,
  balance:98765,
  gifts:[] as Array<Record<string,unknown>>,
  missions:[] as Array<Record<string,unknown>>,
  myMissions:[] as Array<Record<string,unknown>>,
}));
vi.mock("@tanstack/react-router",()=>({useNavigate:()=>h.navigate,Link:({children,to,onClick}:{children:React.ReactNode;to:string;onClick?:()=>void})=><a href={to} onClick={event=>{event.preventDefault();onClick?.();}}>{children}</a>}));
vi.mock("@/lib/activationAnalytics",()=>({trackActivationEvent:(name:string,properties:unknown)=>{h.track.push([name,properties]);return true;}}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:h.lang,t:(key:string)=>LEVEL_LABELS[key]??key})}));
vi.mock("@/lib/features",()=>({get STUDIO_THREADS(){return h.enabled;}}));
vi.mock("@/lib/queries/kocmax",()=>({
  useMe:()=>({data:{id:"owner",level:"L1",effective_level:"L1",xp:12345},isError:!!h.meError,error:h.meError,refetch:vi.fn()}),
  useBalance:()=>({data:{balance:h.balance},isError:!!h.balanceError,error:h.balanceError,refetch:vi.fn()}),
  useMissions:()=>({data:h.missions,refetch:vi.fn()}),
  useGifts:()=>({data:h.gifts,isError:false,refetch:vi.fn()}),
  useMyMissions:()=>({data:h.myMissions,isError:false,refetch:vi.fn()}),
}));
vi.mock("@/lib/studio/queries",()=>({useStudioThreads:(...args:unknown[])=>{h.historyOptions(...args);return {data:{threads:[{id:"private",title:"PRIVATE_HISTORY_TITLE",topic:"creation",created_at:"2026-11-01T00:00:00.000Z"}],nextPage:null},isError:!!h.historyError,error:h.historyError,refetch:vi.fn()};},useStudioCommand:()=>({mutateAsync:h.mutate,isPending:false})}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:{badges:[]}})}));
import { StudioHome, StudioStarter } from "./StudioHome";
beforeEach(()=>{h.meError=null;h.balanceError=null;h.historyError=null;h.enabled=true;h.mutate.mockReset();h.navigate.mockReset();h.historyOptions.mockReset();h.lang="zh";h.track.length=0;h.balance=98765;h.gifts=[];h.missions=[];h.myMissions=[];});
it.each(["meError","balanceError","historyError"] as const)("hides cached home data and actions after %s 401",key=>{
  h[key]=new ApiError(401,"no_auth","PRIVATE_SERVER_TEXT");
  render(<StudioHome/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toHaveAttribute("href","/login");
  for(const text of ["PRIVATE_LEVEL","PRIVATE_HISTORY_TITLE","KOC 新手","12,345","98,765","PRIVATE_SERVER_TEXT"])expect(document.body).not.toHaveTextContent(text);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"開始討論"})).not.toBeInTheDocument();
});
it("hides the entire home after a create command requires login without replay",async()=>{
  h.mutate.mockRejectedValue(new ApiError(401,"no_auth","PRIVATE_SERVER_TEXT"));
  render(<StudioHome/>);
  fireEvent.change(screen.getByRole("textbox",{name:"想問甚麼？"}),{target:{value:"PRIVATE_PROMPT"}});
  fireEvent.click(screen.getByRole("button",{name:"開始討論"}));
  await screen.findByRole("link",{name:"前往登入"});
  expect(document.body).not.toHaveTextContent("PRIVATE_HISTORY_TITLE");
  expect(document.body).not.toHaveTextContent("PRIVATE_LEVEL");
  expect(document.body).not.toHaveTextContent("KOC 新手");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(h.mutate).toHaveBeenCalledTimes(1);expect(h.navigate).not.toHaveBeenCalled();
});
it.each([new ApiError(503,"unavailable","unavailable"),new Error("offline"),null])("does not reveal cached home after 401 is replaced by %s",error=>{
  h.historyError=new ApiError(401,"no_auth","no_auth");
  const view=render(<StudioHome/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toBeVisible();
  h.historyError=error;
  view.rerender(<StudioHome/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toBeVisible();
  expect(document.body).not.toHaveTextContent("PRIVATE_HISTORY_TITLE");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("contains a standalone starter after command 401",async()=>{
  h.mutate.mockRejectedValue(new ApiError(401,"no_auth","no_auth"));
  render(<StudioStarter/>);
  fireEvent.change(screen.getByRole("textbox",{name:"想問甚麼？"}),{target:{value:"private"}});
  fireEvent.click(screen.getByRole("button",{name:"開始討論"}));
  await screen.findByRole("link",{name:"前往登入"});
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(h.mutate).toHaveBeenCalledTimes(1);
});
it("retains transient creation input and reuses its id only on explicit retry",async()=>{
  h.mutate.mockRejectedValue(new ApiError(503,"unavailable","unavailable"));
  render(<StudioStarter/>);
  const input=screen.getByRole("textbox",{name:"想問甚麼？"});
  fireEvent.change(input,{target:{value:"Keep my idea"}});
  fireEvent.click(screen.getByRole("button",{name:"開始討論"}));
  await waitFor(()=>expect(h.mutate).toHaveBeenCalledTimes(1));
  expect(input).toHaveValue("Keep my idea");
  expect(screen.queryByRole("link",{name:"前往登入"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"開始討論"}));
  await waitFor(()=>expect(h.mutate).toHaveBeenCalledTimes(2));
  expect(h.mutate.mock.calls[1][0].requestId).toBe(h.mutate.mock.calls[0][0].requestId);
});
it("keeps the starter idea list short until the creator asks for more",()=>{
  render(<StudioStarter/>);
  expect(screen.getAllByRole("button",{name:/積分按任務/})).toHaveLength(4);
  fireEvent.click(screen.getByRole("button",{name:"顯示其餘 6 個靈感"}));
  expect(screen.getAllByRole("button",{name:/積分按任務/})).toHaveLength(10);
  expect(screen.getByRole("button",{name:"收起靈感"})).toBeVisible();
});
it("keeps threads disabled and ignores their stale error when the rollout flag is off",()=>{
  h.enabled=false;h.historyError=new ApiError(401,"no_auth","no_auth");
  render(<StudioHome/>);
  expect(screen.getByText("工作室對話尚未開放，你仍可完成所有原有任務。")).toBeVisible();
  expect(h.historyOptions).toHaveBeenCalledWith(0,false);
  expect(screen.queryByRole("link",{name:"前往登入"})).not.toBeInTheDocument();
});
it("shows the localized level name and links the tile to the passport",()=>{
  render(<StudioHome/>);
  expect(screen.getByRole("link",{name:/KOC 新手/})).toHaveAttribute("href","/passport");
});
it("spells out the experience left before the next level",()=>{
  render(<StudioHome/>);
  expect(screen.getByText(/還差 2,655 XP 到/)).toBeInTheDocument();
});
it("shows how many points are left before the next reward",()=>{
  h.balance=98765;
  h.gifts=[{id:"g1",name:"咖啡券",points_cost:100000,stock_remaining:5,status:"available",gift_type:"voucher"}];
  render(<StudioHome/>);
  expect(screen.getByText("咖啡券")).toBeInTheDocument();
  expect(screen.getByText("還差 1,235 分")).toBeInTheDocument();
});
it("offers the claim action as soon as a reward is affordable",()=>{
  h.gifts=[{id:"g1",name:"咖啡券",points_cost:500,stock_remaining:5,status:"available",gift_type:"voucher"}];
  render(<StudioHome/>);
  expect(screen.getByRole("link",{name:/去兌換/})).toHaveAttribute("href","/redemption");
});
it("shows the level gate and deadline on today's missions",()=>{
  h.missions=[{id:"m1",slug:"tasting",title:"試飲任務",points_reward:200,required_level:"L2",deadline:"2026-12-01T00:00:00.000Z"}];
  render(<StudioHome/>);
  expect(screen.getByText("L2")).toBeInTheDocument();
  expect(screen.getByText("2026-12-01")).toBeInTheDocument();
});
it("surfaces one unfinished mission above the composer",()=>{
  h.myMissions=[{id:"s1",status:"joined",missions:{slug:"tasting",title:"試飲任務",points_reward:200},creator_studio_available:false}];
  render(<StudioHome/>);
  expect(screen.getByRole("heading",{name:"試飲任務"})).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"繼續"})).toBeInTheDocument();
});
it("renders English skill titles when the interface is English",()=>{
  h.lang="en";
  render(<StudioStarter/>);
  expect(screen.getByText("Read the image")).toBeInTheDocument();
  expect(screen.queryByText("看懂圖片問題")).not.toBeInTheDocument();
});
it("marks the applied idea and restores the previous draft on undo",()=>{
  render(<StudioStarter/>);
  const box=screen.getByRole("textbox",{name:"想問甚麼？"});
  const idea=screen.getByRole("button",{name:/挑一個適合我的任務/});
  fireEvent.click(idea);
  expect(idea).toHaveAttribute("aria-pressed","true");
  expect(box).toHaveValue("這週哪些任務最適合我的時間和內容方向？");
  fireEvent.click(screen.getByRole("button",{name:"還原"}));
  expect(box).toHaveValue("");
  expect(screen.queryByRole("button",{name:"還原"})).not.toBeInTheDocument();
});
it("clears the applied marker once the creator edits the prompt",()=>{
  render(<StudioStarter/>);
  const box=screen.getByRole("textbox",{name:"想問甚麼？"});
  fireEvent.click(screen.getByRole("button",{name:/挑一個適合我的任務/}));
  expect(screen.getByRole("button",{name:"還原"})).toBeInTheDocument();
  fireEvent.change(box,{target:{value:"改寫一下"}});
  expect(screen.queryByRole("button",{name:"還原"})).not.toBeInTheDocument();
});
it("starts the chat with Ctrl+Enter from the question box",async()=>{
  render(<StudioStarter/>);
  const box=screen.getByRole("textbox",{name:"想問甚麼？"});
  fireEvent.change(box,{target:{value:"幫我寫下一篇文案"}});
  fireEvent.keyDown(box,{key:"Enter",code:"Enter",ctrlKey:true});
  await waitFor(()=>expect(h.mutate).toHaveBeenCalledTimes(1));
});
it("counts characters only as the prompt nears the limit",()=>{
  render(<StudioStarter/>);
  const box=screen.getByRole("textbox",{name:"想問甚麼？"});
  expect(screen.queryByText(/\/4000$/)).not.toBeInTheDocument();
  fireEvent.change(box,{target:{value:"a".repeat(3700)}});
  expect(screen.getByText("3700/4000")).toBeInTheDocument();
});
it("emits activation events for the template, continue and reward actions",()=>{
  h.myMissions=[{id:"s1",status:"joined",missions:{slug:"tasting",title:"試飲任務",points_reward:200},creator_studio_available:false}];
  h.gifts=[{id:"g1",name:"咖啡券",points_cost:500,stock_remaining:5,status:"available",gift_type:"voucher"}];
  render(<StudioHome/>);
  fireEvent.click(screen.getByRole("button",{name:/挑一個適合我的任務/}));
  fireEvent.click(screen.getByRole("link",{name:"繼續"}));
  fireEvent.click(screen.getByRole("link",{name:/去兌換/}));
  expect(h.track).toEqual([
    ["template_applied",{locale:"zh",templateId:"pick",topic:"missions"}],
    ["continue_clicked",{locale:"zh",target:"mission"}],
    ["reward_card_clicked",{locale:"zh",rewardKind:"claimable"}],
  ]);
});
