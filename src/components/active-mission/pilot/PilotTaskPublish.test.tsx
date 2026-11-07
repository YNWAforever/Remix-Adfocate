import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {PilotTaskPublish,type PilotTaskApi} from "./PilotTaskPublish";
const status={id:"intent",state:"published" as const,version:5,sampleOnly:true as const,accountLabel:"@demo",approvedVersionId:"v3",instructionRevision:1,canSubmitRealProof:false as const,providerRevocation:"unverified" as const};
function setup(current:typeof status|null=null){const api:PilotTaskApi={current:vi.fn(async()=>current),preview:vi.fn(async()=>({sampleOnly:true as const,caption:"Tea #合作",imageSha256:"a".repeat(64),imagePath:"/api/controlled-pilot-mock/image",accountLabel:"@demo",approvedVersionId:"v3",instructionRevision:1,disclosures:["#合作"],sponsorIds:["44444"],expiresAt:"2099-01-01T00:00:00Z",confirmation:{approvalId:"a",nonce:"n",fingerprint:"f",requestId:"r"}})),approve:vi.fn(async()=>status),reconcile:vi.fn(async()=>status),image:vi.fn(async()=>"blob:fixture")};return api;}
it("loads owned status first and requires unchecked explicit consent before mock publication",async()=>{
 const api=setup();render(<PilotTaskPublish api={api} approvedVersionId="v3" instructionRevision={1} onReturnToProof={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:"查看核准作品"}));
 const confirm=await screen.findByRole("button",{name:"確認這篇模擬發佈"});expect(confirm).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(confirm);await screen.findByText("模擬已發佈");expect(api.approve).toHaveBeenCalledTimes(1);
});
it("reload displays existing status without prepare or approve",async()=>{
 const api=setup(status);render(<PilotTaskPublish api={api} approvedVersionId="v3" instructionRevision={1} onReturnToProof={()=>{}}/>);
 await screen.findByText("模擬已發佈");expect(api.preview).not.toHaveBeenCalled();expect(api.approve).not.toHaveBeenCalled();
});
it("session errors hide content and never automatically resubmit",async()=>{
 const api=setup();vi.mocked(api.current).mockRejectedValue(new Error("SESSION_REQUIRED"));render(<PilotTaskPublish api={api} approvedVersionId="v3" instructionRevision={1} onReturnToProof={()=>{}}/>);
 await screen.findByRole("alert");expect(screen.queryByRole("button",{name:"查看核准作品"})).toBeNull();expect(api.approve).not.toHaveBeenCalled();
});
it("invalidates a preview when the original approved version changes",async()=>{
 const api=setup(),view=render(<PilotTaskPublish api={api} approvedVersionId="v3" instructionRevision={1} onReturnToProof={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:"查看核准作品"}));await screen.findByRole("checkbox");
 view.rerender(<PilotTaskPublish api={api} approvedVersionId="v4" instructionRevision={2} onReturnToProof={()=>{}}/>);
 await waitFor(()=>expect(screen.queryByRole("checkbox")).toBeNull());expect(api.approve).not.toHaveBeenCalled();
});
