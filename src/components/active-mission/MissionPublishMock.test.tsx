import {expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {context} from "@/test/missionPublishTestData";
import {MockMissionPublishRegistry} from "@/lib/creatorGrowth/mockMissionPublish";
import {MissionPublishMock} from "./MissionPublishMock";
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"zh"})}));
vi.mock("../studio/PublishPreview",()=>({PublishPreview:({model,onConfirm,onCancel}:{model:{fingerprint:string;nonce:string;caption:string;disclosure:{captionText:string}};onConfirm:(v:unknown)=>void;onCancel:()=>void})=><div><p>{model.caption}</p><span data-testid="disclosure">{model.disclosure.captionText}</span><button onClick={()=>onConfirm(model)}>Confirm mock</button><button onClick={onCancel}>Cancel mock</button></div>}));
const image={bytes:new Uint8Array([255,216,255,217]),mime:"image/jpeg" as const,width:480,height:600,byteSize:4,sha256:"a".repeat(64)};
it("uses an exact approved caption span for multiple nonadjacent disclosures",async()=>{
 vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:()=>"blob:http://localhost/example",revokeObjectURL:vi.fn()}));
 const c=context();c.item.versions![0].caption="Tea #合作 and #廣告";c.publication={...c.publication,instructions:{...c.publication.instructions,requiredDisclosures:["#合作","#廣告"]}};
 render(<MissionPublishMock context={c} registry={new MockMissionPublishRegistry()} prepareImage={async()=>image} onReturnToProof={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"發佈到 Instagram（模擬）"}));await screen.findByText("Confirm mock");
 const text=screen.getByTestId("disclosure").textContent!;expect(c.item.versions![0].caption).toContain(text);expect(text).toContain("#合作");expect(text).toContain("#廣告");
});
it("opens exact approved preview then returns only through navigation callback",async()=>{
 vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:()=>"blob:http://localhost/example",revokeObjectURL:vi.fn()}));
 const onReturnToProof=vi.fn();render(<MissionPublishMock context={context()} registry={new MockMissionPublishRegistry()} prepareImage={async()=>image} onReturnToProof={onReturnToProof}/>);
 fireEvent.click(screen.getByRole("button",{name:"發佈到 Instagram（模擬）"}));
 await screen.findByText("Tea #合作");fireEvent.click(screen.getByText("Confirm mock"));
 await screen.findByText("作品已發佈（模擬）");fireEvent.click(screen.getByRole("button",{name:"返回任務核對證明"}));
 expect(onReturnToProof).toHaveBeenCalledOnce();expect(document.body).toHaveTextContent("未提交證明，未增加積分");
});
it("blocks private rights and does not prepare a preview",()=>{
 const c=context();c.rights.sources="private";const prepareImage=vi.fn();
 render(<MissionPublishMock context={c} registry={new MockMissionPublishRegistry()} prepareImage={prepareImage} onReturnToProof={vi.fn()}/>);
 expect(screen.getByRole("button",{name:"發佈到 Instagram（模擬）"})).toBeDisabled();expect(prepareImage).not.toHaveBeenCalled();
});
it("invalidates open confirmation when the same version content changes",async()=>{
 const c=context(),registry=new MockMissionPublishRegistry();const view=render(<MissionPublishMock context={c} registry={registry} prepareImage={async()=>image} onReturnToProof={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"發佈到 Instagram（模擬）"}));await screen.findByText("Confirm mock");
 const changed=structuredClone(c);changed.item.versions![0].caption+=" changed";
 view.rerender(<MissionPublishMock context={changed} registry={registry} prepareImage={async()=>image} onReturnToProof={vi.fn()}/>);
 await waitFor(()=>expect(screen.queryByText("Confirm mock")).not.toBeInTheDocument());
});
