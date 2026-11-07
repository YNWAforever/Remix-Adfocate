import {afterEach,expect,it,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import {MissionPublishEntryHost} from "./MissionPublishEntry";
vi.mock("./MissionPublishEntryDev",()=>({default:()=> <div>DEV_MISSION_ENTRY</div>}));
afterEach(()=>vi.unstubAllEnvs());
it.each([[false,"true"],[true,"false"]])("renders no mock when DEV=%s fixture=%s",(dev,flag)=>{
 vi.stubEnv("DEV",dev);vi.stubEnv("VITE_STUDIO_FIXTURE",flag);
 const view=render(<MissionPublishEntryHost submissionId="x" item={null} publication={null} onReturnToProof={vi.fn()}/>);
 expect(view.container).toBeEmptyDOMElement();
});
it("loads only opt-in development entry",async()=>{
 vi.stubEnv("DEV",true);vi.stubEnv("VITE_STUDIO_FIXTURE","true");
 render(<MissionPublishEntryHost submissionId="x" item={null} publication={null} onReturnToProof={vi.fn()}/>);
 expect(await screen.findByText("DEV_MISSION_ENTRY")).toBeVisible();
});
