import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StudioDetail } from "@/lib/studio/types";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/api";
vi.mock("../integrations/IntegrationSourcePanel",()=>({IntegrationSourcePanel:({onLoginRequired}:{onLoginRequired?:()=>void})=><button onClick={onLoginRequired}>Simulate source session loss</button>}));
const h=vi.hoisted(()=>({historyError:null as Error|null,history:[] as {id:string;title:string}[],error:null as Error|null,refetch:vi.fn(),detail:null as StudioDetail|null,blocker:null as {shouldBlockFn:()=>boolean;enableBeforeUnload?:boolean}|null,mutate:vi.fn(),chat:vi.fn(),invalidate:vi.fn()}));
vi.mock("@tanstack/react-router",()=>({useBlocker:(options:{shouldBlockFn:()=>boolean})=>{h.blocker=options;},useNavigate:()=>vi.fn(),Link:({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"zh"})}));
vi.mock("@/lib/queries/kocmax",()=>({useAssistantChat:()=>({isPending:false,mutateAsync:h.chat}),useMe:()=>({data:{id:"creator-a"}}),useMissions:()=>({data:[]}),useMyMissions:()=>({data:[{id:"submission",creator_workflow_mode:"active_workspace",missions:{title:"Tea"}}]})}));
vi.mock("@/lib/studio/queries",()=>({studioKeys:{detail:(id:string)=>[id]},useStudioThreads:()=>({data:{threads:h.history,nextPage:null},error:h.historyError,isError:!!h.historyError}),useStudioThread:()=>({data:h.detail,isError:!!h.error,error:h.error,refetch:h.refetch}),useStudioCommand:()=>({mutateAsync:h.mutate,isPending:false})}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:h.invalidate}),useQuery:()=>({data:{workflow:{state:"drafting"},pendingReward:null,workItems:[{id:"item",title:"Reel",state:"drafting",draft:{revision:2}}]}})}));
import { StudioWorkspace } from "./StudioWorkspace";
it("copies saved private content without writes, clears targets and focuses the editor",()=>{
  prepare();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  expect(screen.getByText("由 v1 複製 · 未保存 · 私人")).toBeVisible();
  expect(screen.getByRole("heading",{name:"你的拍攝 Brief"})).toHaveFocus();
  expect(screen.getByRole("textbox",{name:"段落 1"})).toHaveValue("Private observation");
  expect(screen.getByRole("textbox",{name:"段落 1"}).id).not.toBe("brief-private-section");
  expect(screen.getByRole("combobox",{name:"選擇已接任務"})).toHaveValue("");
  expect(screen.getByRole("button",{name:"保存私人 Brief"})).toBeEnabled();
  expect(h.mutate).not.toHaveBeenCalled();
});
it("keeps unsaved edits on cancel and returns focus to the initiating card",()=>{
  prepare();fireEvent.change(screen.getByRole("textbox",{name:"段落 1"}),{target:{value:"Keep this"}});
  const button=screen.getByRole("button",{name:"複製 Brief v1 成新草稿"});fireEvent.click(button);
  fireEvent.click(screen.getByRole("button",{name:"保留目前草稿"}));
  expect(screen.getByRole("textbox",{name:"段落 1"})).toHaveValue("Keep this");expect(button).toHaveFocus();
});
it.each(["revoked","removed"])("revalidates %s while replacement is open",kind=>{
  const view=prepare();fireEvent.change(screen.getByRole("textbox",{name:"段落 1"}),{target:{value:"Keep this"}});
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  if(kind==="revoked")h.detail!.sources[0].revoked_at="2026-11-05";else h.detail!.briefs=[];
  view.rerender(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("button",{name:"以此版本建立草稿"}));
  expect(screen.getByRole("textbox",{name:"段落 1"})).toHaveValue("Keep this");
  expect(document.body).toHaveTextContent("版本或來源已改變");expect(h.mutate).not.toHaveBeenCalled();
});
it("retains unknown save request and blocks copying until the same request resolves",async()=>{
  h.mutate.mockRejectedValue(new Error("offline"));prepare();
  fireEvent.change(screen.getByRole("textbox",{name:"段落 1"}),{target:{value:"Edit"}});
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  await waitFor(()=>expect(document.body).toHaveTextContent("未能保存"));
  expect(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  await waitFor(()=>expect(h.mutate).toHaveBeenCalledTimes(2));
  expect(h.mutate.mock.calls[1][0].requestId).toBe(h.mutate.mock.calls[0][0].requestId);
});
it.each([false,true])("marks exactly saved copy saved without clobbering later edits (edit=%s)",async edit=>{
  let resolve!:(v:unknown)=>void;h.mutate.mockImplementation(()=>new Promise(r=>{resolve=r;}));prepare();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  expect(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"})).toBeDisabled();
  const saved=h.mutate.mock.calls[0][0].payload.sections;
  if(edit)fireEvent.change(screen.getByRole("textbox",{name:"段落 1"}),{target:{value:"Later edit"}});
  resolve({result:{...h.detail!.briefs[0],id:"new",version:2,sections:saved}});
  await waitFor(()=>expect(document.body).toHaveTextContent("私人 Brief 已保存"));
  expect(screen.getByText(edit?"由 v1 複製 · 未保存 · 私人":"由 v1 複製 · 已保存 · 私人")).toBeVisible();
  expect(screen.getByRole("textbox",{name:"段落 1"})).toHaveValue(edit?"Later edit":"Private observation");
});
it("handles detail refetch before save resolution and never steals typing focus",async()=>{
  let resolve!:(v:unknown)=>void;h.mutate.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=prepare();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  const saved={...h.detail!.briefs[0],id:"saved",version:2,sections:h.mutate.mock.calls[0][0].payload.sections};
  h.detail={...h.detail!,thread:{...h.detail!.thread,revision:3},briefs:[saved,...h.detail!.briefs]};
  view.rerender(<StudioWorkspace threadId="thread"/>);
  const input=screen.getByRole("textbox",{name:"段落 1"});input.focus();fireEvent.change(input,{target:{value:"Newer local edit"}});
  resolve({result:saved});await waitFor(()=>expect(document.body).toHaveTextContent("私人 Brief 已保存"));
  view.rerender(<StudioWorkspace threadId="thread"/>);
  expect(input).toHaveValue("Newer local edit");expect(input).toHaveFocus();
  expect(screen.getByText("由 v1 複製 · 未保存 · 私人")).toBeVisible();
});
it("failed copied save retains origin and sections; 401 removes the replacement chooser",async()=>{
  h.mutate.mockRejectedValue(new ApiError(409,"stale","stale"));const view=prepare();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  await waitFor(()=>expect(document.body).toHaveTextContent("未能保存"));
  expect(screen.getByText("由 v1 複製 · 未保存 · 私人")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  expect(screen.getByRole("button",{name:"保留目前草稿"})).toBeVisible();
  h.error=new ApiError(401,"no_auth","no_auth");view.rerender(<StudioWorkspace threadId="thread"/>);
  expect(screen.queryByRole("button",{name:"保留目前草稿"})).not.toBeInTheDocument();
  expect(screen.queryByText("Private observation")).not.toBeInTheDocument();
});
beforeEach(()=>{
  vi.restoreAllMocks();
  h.blocker=null;
  h.error=null;h.refetch.mockReset();
  h.historyError=null;h.history=[];
  h.chat.mockReset();
  h.mutate.mockReset();h.detail={thread:{id:"thread",title:"Tea brief",topic:"creation",mission_id:null,conversation_id:"conversation",revision:2,created_at:"2026-10-31"},sources:[{id:"private",thread_id:"thread",title:"Private note",content:"Private observation",kind:"private",shareable:false,question:"Question",platform:"manual",region:"HK",language:"zh-Hant",observed_at:"2026-10-31T00:00:00Z",url:null,revoked_at:null,status:"unverified"}],briefs:[{id:"brief",thread_id:"thread",version:1,created_at:"2026-10-31",sections:[{id:"private-section",text:"Private observation",sourceIds:["private"]},{id:"own",text:"My own idea",sourceIds:[]}]}],shares:[],messages:[]};
});
it.each(["detail","history"])("contains cached private content when %s requires login",source=>{
  h.history=[{id:"thread",title:"PRIVATE_HISTORY_TITLE"}];
  const error=new ApiError(401,"no_auth","PRIVATE_SERVER_MESSAGE");
  if(source==="detail") h.error=error; else h.historyError=error;
  render(<StudioWorkspace threadId="thread"/>);
  expect(screen.getByRole("alert")).toHaveTextContent("請重新登入，再繼續創作");
  expect(screen.getByRole("link",{name:"前往登入"})).toHaveAttribute("href","/login");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation",{name:"歷史討論串"})).not.toBeInTheDocument();
  for(const privateText of ["PRIVATE_HISTORY_TITLE","Tea brief","Private observation","PRIVATE_SERVER_MESSAGE"]) expect(document.body).not.toHaveTextContent(privateText);
  expect(screen.queryByRole("button",{name:"再試一次"})).not.toBeInTheDocument();
  expect(h.refetch).not.toHaveBeenCalled();expect(h.mutate).not.toHaveBeenCalled();expect(h.chat).not.toHaveBeenCalled();
});
it("hides the new-thread composer when history requires login",()=>{
  h.historyError=new ApiError(401,"no_auth","no_auth");
  render(<StudioWorkspace/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toHaveAttribute("href","/login");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("keeps detail hidden after a background error replaces an earlier 401",()=>{
  h.error=new ApiError(401,"no_auth","no_auth");
  const view=render(<StudioWorkspace threadId="thread"/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toBeVisible();
  h.error=new ApiError(503,"offline","offline");
  view.rerender(<StudioWorkspace threadId="thread"/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toBeVisible();
  expect(screen.queryByRole("button",{name:"再試一次"})).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it.each([403,404])("offers neutral recovery for %s without revealing cached private detail or server text",status=>{
  h.error=new ApiError(status,"PRIVATE_THREAD_CODE","PRIVATE_SERVER_MESSAGE");
  render(<StudioWorkspace threadId="thread"/>);
  expect(screen.getByRole("alert")).toHaveTextContent("目前無法開啟這段討論");
  expect(screen.getByRole("link",{name:"返回我的工作室"})).toHaveAttribute("href","/home");
  expect(screen.queryByRole("button",{name:"再試一次"})).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox",{name:"繼續討論"})).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("Tea brief");
  expect(document.body).not.toHaveTextContent("Private observation");
  expect(document.body).not.toHaveTextContent("PRIVATE_SERVER_MESSAGE");
  expect(h.refetch).not.toHaveBeenCalled();
});
it.each([new ApiError(503,"UNAVAILABLE","PRIVATE_SERVER_MESSAGE"),new Error("offline")])("retains explicit retry for transient failures: %s",error=>{
  h.error=error;
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("button",{name:"再試一次"}));
  expect(h.refetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("link",{name:"返回我的工作室"})).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("PRIVATE_SERVER_MESSAGE");
});
it("enables router unload protection only for actual unsaved work",()=>{
  render(<StudioWorkspace threadId="thread"/>);
  expect(h.blocker?.enableBeforeUnload).toBe(false);
  const clean=new Event("beforeunload",{cancelable:true});window.dispatchEvent(clean);expect(clean.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:"Unsaved message"}});
  expect(h.blocker?.enableBeforeUnload).toBe(true);
  const dirty=new Event("beforeunload",{cancelable:true});window.dispatchEvent(dirty);expect(dirty.defaultPrevented).toBe(true);
  fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:""}});
  expect(h.blocker?.enableBeforeUnload).toBe(false);
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
it("shows an unsaved answer and keeps the input when persistence is unresolved",async()=>{
  h.chat.mockResolvedValue({request_id:"req-unsaved",answer:"這是未保存的建議",citations:[],persistence:"failed",code:"history_unavailable"});
  render(<StudioWorkspace threadId="thread"/>);
  const input=screen.getByRole("textbox",{name:"繼續討論"});
  fireEvent.change(input,{target:{value:"點樣開始？"}});
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  await screen.findByText("這是未保存的建議");
  expect(screen.getByText("未保存 · 建議內容")).toBeVisible();
  expect(document.querySelector(".s-chat")).toHaveTextContent("點樣開始？");
  expect(input).toHaveValue("點樣開始？");
  expect(h.invalidate).not.toHaveBeenCalled();
});
it("shows which read-only data backed a saved reply",async()=>{
  h.chat.mockResolvedValue({request_id:"req-tools",answer:"你目前有 120 分。",citations:[],persistence:"saved",tools_used:["get_my_points","get_my_missions"]});
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:"我有多少分？"}});
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  await waitFor(()=>expect(h.invalidate).toHaveBeenCalledTimes(1));
  expect(screen.getByText("積分")).toBeVisible();
  expect(screen.getByText("我的任務")).toBeVisible();
  expect(screen.getByRole("textbox",{name:"繼續討論"})).toHaveValue("");
});
function prepare() {
  const view=render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("tab",{name:"Brief 與成果"}));
  fireEvent.change(screen.getByRole("combobox",{name:"選擇已接任務"}),{target:{value:"submission"}});
  fireEvent.change(screen.getByRole("combobox",{name:"選擇交付項目"}),{target:{value:"item"}});
  return view;
}
it.each(["chat","save","share","revoke"])("requires login after %s command 401 without replay or private output",async action=>{
  h.history=[{id:"thread",title:"PRIVATE_HISTORY"}];
  const denied=new ApiError(401,"no_auth","PRIVATE_SERVER_TEXT");
  h.mutate.mockRejectedValue(denied);h.chat.mockRejectedValue(denied);
  if(action==="share") {
    prepare();fireEvent.click(screen.getByRole("checkbox",{name:/段落 2/}));
    fireEvent.click(screen.getByRole("checkbox",{name:/我已檢查所選內容/}));
    fireEvent.click(screen.getByRole("button",{name:"存入原任務草稿"}));
  } else {
    render(<StudioWorkspace threadId="thread"/>);
    if(action==="chat") {
      fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:"Private input"}});
      fireEvent.click(screen.getByRole("button",{name:"送出"}));
    } else if(action==="save") {
      fireEvent.click(screen.getByRole("tab",{name:"Brief 與成果"}));
      fireEvent.change(screen.getByRole("textbox",{name:"段落 2"}),{target:{value:"Edited private idea"}});
      fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
    } else {
      fireEvent.click(screen.getByRole("tab",{name:"證據"}));
      fireEvent.click(screen.getByRole("button",{name:"撤銷來源"}));
    }
  }
  await screen.findByRole("link",{name:"前往登入"});
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for(const text of ["PRIVATE_HISTORY","Private observation","PRIVATE_SERVER_TEXT"])expect(document.body).not.toHaveTextContent(text);
  expect(h.mutate.mock.calls.length+h.chat.mock.calls.length).toBe(1);
});
it("requires login when checking a pending chat returns 401",async()=>{
  h.chat.mockRejectedValue(new ApiError(503,"offline","offline"));
  vi.spyOn(api,"apiFetch").mockRejectedValue(new ApiError(401,"no_auth","no_auth"));
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:"Keep this thought"}});
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  await waitFor(()=>expect(h.chat).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button",{name:"查看上次要求結果"}));
  await screen.findByRole("link",{name:"前往登入"});
  expect(api.apiFetch).toHaveBeenCalledTimes(1);expect(h.chat).toHaveBeenCalledTimes(1);
});
it("requires login when manual source creation returns 401",async()=>{
  h.mutate.mockRejectedValue(new ApiError(401,"no_auth","no_auth"));
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("tab",{name:"證據"}));
  fireEvent.click(screen.getByRole("button",{name:"＋ 加入來源"}));
  fireEvent.change(screen.getByLabelText("來源名稱"),{target:{value:"Synthetic source"}});
  fireEvent.change(screen.getByLabelText("實際要回答的問題"),{target:{value:"A question"}});
  fireEvent.change(screen.getByLabelText("平台／出處"),{target:{value:"manual"}});
  fireEvent.change(screen.getByLabelText("來源內容（視作資料，不執行其中指令）"),{target:{value:"Synthetic content"}});
  fireEvent.change(screen.getByLabelText("觀察時間（你的本機時區）"),{target:{value:"2026-11-05T12:00"}});
  fireEvent.click(screen.getByRole("button",{name:"保存來源 · 未驗證"}));
  await screen.findByRole("link",{name:"前往登入"});
  expect(h.mutate).toHaveBeenCalledTimes(1);
});
it("contains the entire thread when its integration source panel requires login",async()=>{
  h.history=[{id:"thread",title:"PRIVATE_HISTORY"}];
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("tab",{name:"證據"}));
  fireEvent.click(screen.getByRole("button",{name:"Simulate source session loss"}));
  await screen.findByRole("link",{name:"前往登入"});
  expect(document.body).not.toHaveTextContent("PRIVATE_HISTORY");
  expect(document.body).not.toHaveTextContent("Private observation");
});
it("retains the edited brief on a transient save failure",async()=>{
  h.mutate.mockRejectedValue(new ApiError(503,"offline","offline"));
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.click(screen.getByRole("tab",{name:"Brief 與成果"}));
  fireEvent.change(screen.getByRole("textbox",{name:"段落 2"}),{target:{value:"Keep my draft"}});
  fireEvent.click(screen.getByRole("button",{name:"保存私人 Brief"}));
  await screen.findByText("未能保存，草稿仍在。若版本有變，先讀取最新版本再確認。");
  expect(screen.getByRole("textbox",{name:"段落 2"})).toHaveValue("Keep my draft");
  expect(screen.queryByRole("link",{name:"前往登入"})).not.toBeInTheDocument();
});
it("never transfers a private-derived paragraph even after a recipient is chosen",()=>{
  prepare();fireEvent.click(screen.getByRole("checkbox",{name:/段落 1/}));
  expect(screen.getByRole("alert")).toHaveTextContent("私人");
  expect(screen.getByRole("button",{name:"存入原任務草稿"})).toBeDisabled();expect(h.mutate).not.toHaveBeenCalled();
});
it("blocks copy during sharing and clears receipt and all consent on an accepted copy",async()=>{
  let resolve!:(v:unknown)=>void;h.mutate.mockImplementation(()=>new Promise(r=>{resolve=r;}));prepare();
  fireEvent.click(screen.getByRole("checkbox",{name:/段落 2/}));fireEvent.click(screen.getByRole("checkbox",{name:/我已檢查所選內容/}));
  fireEvent.click(screen.getByRole("button",{name:"存入原任務草稿"}));
  expect(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"})).toBeDisabled();
  resolve({result:{id:"receipt",brief_id:"brief",submission_id:"submission",work_item_id:"item",section_ids:["own"],draft_revision:3,created_at:"2026-11-05"}});
  await screen.findByRole("link",{name:"前往任務核對並提交"});
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"}));
  expect(screen.queryByRole("link",{name:"前往任務核對並提交"})).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:/段落 2/})).not.toBeChecked();
  expect(screen.getByRole("checkbox",{name:/我已檢查所選內容/})).not.toBeChecked();
  expect(screen.getByRole("combobox",{name:"選擇已接任務"})).toHaveValue("");
  expect(screen.getByRole("combobox",{name:"選擇交付項目"})).toHaveValue("");
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

it("keeps the composer before the four growth cards on the empty Studio entry",()=>{
  render(<StudioWorkspace/>);
  const composer=screen.getByRole("textbox",{name:"想問甚麼？"});
  const growthHeading=screen.getByRole("heading",{name:"挑一個成長技能"});
  expect(composer.compareDocumentPosition(growthHeading)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelectorAll("[data-skill]")).toHaveLength(4);
});

it("asks for confirmation before applying a proposed brief",async()=>{
  h.chat.mockResolvedValue({persistence:"saved",request_id:"req-1",conversation_id:"conv-1",answer:"我建議兩段內容。",proposals:[{kind:"brief",sections:["第一段：真實體驗","第二段：產品限制"]}]});
  render(<StudioWorkspace threadId="thread"/>);
  fireEvent.change(screen.getByRole("textbox",{name:"繼續討論"}),{target:{value:"幫我擬一個 Brief"}});
  fireEvent.click(screen.getByRole("button",{name:"送出"}));
  expect(await screen.findByText("建議的私人 Brief")).toBeVisible();
  expect(screen.getByText("不會自動保存；你仍可在 Brief 分頁檢查及保存。")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"套用到 Brief 編輯器"}));
  expect(await screen.findByDisplayValue("第一段：真實體驗")).toBeVisible();
});
it("shows tools saved with an earlier reply after reload",()=>{
  h.detail={...h.detail!,messages:[{id:"m1",role:"assistant",content:"你接咗一杯茶任務。",created_at:"2026-11-09",tools:["get_my_missions","get_open_missions"]}]};
  render(<StudioWorkspace threadId="thread"/>);
  expect(screen.getByText("你接咗一杯茶任務。")).toBeVisible();
  expect(screen.getByText("我的任務")).toBeVisible();
  expect(screen.getByText("公開任務")).toBeVisible();
  expect(screen.getByLabelText("已查閱的資料")).toBeVisible();
  expect(screen.getByText("為什麼這個答案？")).toBeVisible();
});
it("keeps the growth workspace on its own tab",()=>{
  render(<StudioWorkspace threadId="thread" skill="next_caption"/>);
  expect(screen.getByRole("tab",{name:"技能"})).toHaveAttribute("aria-selected","true");
  fireEvent.click(screen.getByRole("tab",{name:"討論"}));
  expect(screen.getByRole("textbox",{name:"繼續討論"})).toBeVisible();
});
it("opens the active thread with only the requested growth skill context",()=>{
  render(<StudioWorkspace threadId="thread" skill="next_caption"/>);
  expect(screen.getByRole("region",{name:"圖片成長工作區"})).toHaveAttribute("data-skill","next_caption");
  expect(screen.getAllByText("寫下一篇文案").length).toBeGreaterThan(0);
  expect(screen.queryByText("檢討貼文表現")).not.toBeInTheDocument();
});

it("protects unsaved growth-only work from navigation and reload",async()=>{
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  render(<StudioWorkspace threadId="thread" skill="next_caption"/>);
  fireEvent.click(await screen.findByRole("button",{name:"查看合成示例"}));
  await waitFor(()=>expect(h.blocker?.shouldBlockFn()).toBe(true));
  expect(confirm).toHaveBeenCalled();
  const unload=new Event("beforeunload",{cancelable:true});
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("keeps the thread-local growth draft across existing Studio tabs",async()=>{
  render(<StudioWorkspace threadId="thread" skill="next_caption"/>);
  fireEvent.click(await screen.findByRole("button",{name:"查看合成示例"}));
  fireEvent.click(screen.getByRole("tab",{name:"證據與草稿"}));
  await screen.findByText("合成示例 · 未驗證");
  const draft=screen.getByLabelText("下一篇貼文草稿");
  fireEvent.change(draft,{target:{value:"Keep this local draft"}});
  fireEvent.click(screen.getByRole("tab",{name:"Brief 與成果"}));
  fireEvent.click(screen.getByRole("tab",{name:"討論"}));
  expect(screen.getByLabelText("下一篇貼文草稿")).toHaveValue("Keep this local draft");
});
