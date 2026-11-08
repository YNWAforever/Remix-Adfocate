import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
const h=vi.hoisted(()=>({meError:null as Error|null,balanceError:null as Error|null,historyError:null as Error|null,enabled:true,mutate:vi.fn(),navigate:vi.fn(),historyOptions:vi.fn()}));
vi.mock("@tanstack/react-router",()=>({useNavigate:()=>h.navigate,Link:({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"zh"})}));
vi.mock("@/lib/features",()=>({get STUDIO_THREADS(){return h.enabled;}}));
vi.mock("@/lib/queries/kocmax",()=>({useMe:()=>({data:{id:"owner",level:"PRIVATE_LEVEL",xp:12345},isError:!!h.meError,error:h.meError,refetch:vi.fn()}),useBalance:()=>({data:{balance:98765},isError:!!h.balanceError,error:h.balanceError}),useMissions:()=>({data:[]})}));
vi.mock("@/lib/studio/queries",()=>({useStudioThreads:(...args:unknown[])=>{h.historyOptions(...args);return {data:{threads:[{id:"private",title:"PRIVATE_HISTORY_TITLE"}],nextPage:null},isError:!!h.historyError,error:h.historyError,refetch:vi.fn()};},useStudioCommand:()=>({mutateAsync:h.mutate,isPending:false})}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:{badges:[]}})}));
import { StudioHome, StudioStarter } from "./StudioHome";
beforeEach(()=>{h.meError=null;h.balanceError=null;h.historyError=null;h.enabled=true;h.mutate.mockReset();h.navigate.mockReset();h.historyOptions.mockReset();});
it.each(["meError","balanceError","historyError"] as const)("hides cached home data and actions after %s 401",key=>{
  h[key]=new ApiError(401,"no_auth","PRIVATE_SERVER_TEXT");
  render(<StudioHome/>);
  expect(screen.getByRole("link",{name:"前往登入"})).toHaveAttribute("href","/login");
  for(const text of ["PRIVATE_LEVEL","PRIVATE_HISTORY_TITLE","98,765","PRIVATE_SERVER_TEXT"])expect(document.body).not.toHaveTextContent(text);
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
