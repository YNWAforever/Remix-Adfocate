import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {PilotReadinessCard} from "./PilotReadinessCard";
import {PilotReadinessPanel} from "../../admin/PilotReadinessPanel";
it("keeps ordinary tasks available and distinguishes mock from live readiness",()=>{
 render(<PilotReadinessCard/>);expect(screen.getByText(/基本任務照常/)).toBeVisible();expect(screen.getByRole("link",{name:"開啟試點任務"})).toHaveAttribute("href","/my/00000000-0000-4000-8000-000000001931");
});
it("operator can inspect and stop mock work, but has no publish or settlement control",async()=>{
 const api={read:vi.fn(async()=>({readiness:{stopped:false,providerRevocation:"unverified",liveReady:false},counts:{publish:1,proof:0,reward:0}})),stop:vi.fn(async()=>{}),scenario:vi.fn(async()=>{})};
 render(<PilotReadinessPanel api={api}/>);await screen.findByText(/模擬發佈 1/);fireEvent.click(screen.getByRole("button",{name:"停止本機試點"}));await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2));expect(api.stop).toHaveBeenCalledOnce();expect(screen.queryByRole("button",{name:"確認發佈"})).toBeNull();
});
