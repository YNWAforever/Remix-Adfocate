import { act, fireEvent, render, screen } from "@testing-library/react";
import { useReducer, useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftEditor } from "./DraftEditor";
import type { MissionWorkItemView } from "@/lib/activeMission";
vi.mock("@/lib/i18n", async () => { const {dict}=await import("@/lib/i18n.dict"); return { useI18n:()=>({lang:"en",t:(key:string)=>dict.en[key]??key}) }; });
const item: MissionWorkItemView = { id:"owned-item",title:"Owned draft",platform:"instagram",required:true,position:0,state:"drafting",deadline:null,
 requirements:[],draft:{id:"owned-draft",revision:3,caption:"Saved before",externalUrl:null,checklist:{},lastSavedAt:"2026-10-25T00:00:00Z"},currentSubmittedVersionId:null,approvedVersionId:null,reviewStartedAt:null,reviewDueAt:null };
afterEach(()=>vi.useRealTimers());
const edit = async () => { fireEvent.change(screen.getByLabelText("Caption or copy"),{target:{value:"Retained local input"}});await act(async()=>vi.advanceTimersByTimeAsync(850)); };
describe("B2 draft recovery without losing authored input",()=>{
 it("compares a real stale revision payload and retries the retained input only on explicit choice",async()=>{
  vi.useFakeTimers();const stale=Object.assign(new Error("stale"),{code:"WORKFLOW_STALE"});
  const onSave=vi.fn().mockRejectedValueOnce(stale).mockResolvedValue({draft:{...item.draft,revision:6}}),onSubmit=vi.fn();
  const view=render(<DraftEditor item={item} onSave={onSave} onSubmit={onSubmit}/>);await edit();
  const currentDraft={...item.draft!,revision:5,caption:"Concurrent server input"};
  view.rerender(<DraftEditor item={{...item,draft:currentDraft}} conflict={{workItemId:item.id,localDraft:{workItemId:item.id,revision:3,caption:"Retained local input",externalUrl:null,checklist:{}},currentDraft}} onSave={onSave} onSubmit={onSubmit}/>);
  expect(screen.getByLabelText("Caption or copy")).toHaveValue("Retained local input");expect(screen.getByText("Concurrent server input")).toBeVisible();
  expect(onSave).toHaveBeenCalledTimes(1);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save retained draft against latest revision"})));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({revision:5,caption:"Retained local input"}));expect(onSubmit).not.toHaveBeenCalled();
 });
 it("keeps network-failed input and retries the same draft revision without submitting",async()=>{
  vi.useFakeTimers();const onSave=vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")).mockResolvedValue({draft:{...item.draft,revision:4}}),onSubmit=vi.fn();
  render(<DraftEditor item={item} onSave={onSave} onSubmit={onSubmit}/>);await edit();
  expect(screen.getByLabelText("Caption or copy")).toHaveValue("Retained local input");
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Retry save"})));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({revision:3,caption:"Retained local input"}));expect(onSave).toHaveBeenCalledTimes(2);expect(onSubmit).not.toHaveBeenCalled();
 });
 it("keeps a readable network failure when the owner recreates its save callback during mutation renders",async()=>{
  vi.useFakeTimers();
  const transport=vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")).mockResolvedValue({draft:{...item.draft,revision:4}}),onSubmit=vi.fn();
  function Owner(){
   const[,rerender]=useReducer(value=>value+1,0);
   return <DraftEditor item={item} onSubmit={onSubmit} onSave={async input=>{
    rerender();try{return await transport(input);}finally{rerender();}
   }}/>;
  }
  render(<Owner/>);await edit();
  expect(screen.getByRole("button",{name:"Retry save"})).toBeVisible();
  await act(async()=>vi.advanceTimersByTimeAsync(3200));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Caption or copy")).toHaveValue("Retained local input");
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Retry save"})));
  await act(async()=>vi.advanceTimersByTimeAsync(2400));
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({revision:3,caption:"Retained local input"}));
  expect(onSubmit).not.toHaveBeenCalled();
 });
 it("does not save the same edit again after a successful save rerenders its owner",async()=>{
  vi.useFakeTimers();const transport=vi.fn().mockResolvedValue({draft:{...item.draft,revision:4}}),onSubmit=vi.fn();
  function Owner(){
   const[,rerender]=useReducer(value=>value+1,0);
   return <DraftEditor item={item} onSubmit={onSubmit} onSave={async input=>{
    rerender();try{return await transport(input);}finally{rerender();}
   }}/>;
  }
  render(<Owner/>);await edit();
  await act(async()=>vi.advanceTimersByTimeAsync(3200));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  expect(onSubmit).not.toHaveBeenCalled();
 });
 it("does not autosave the same edit again when explicit stale recovery clears the owner conflict",async()=>{
  vi.useFakeTimers();const stale=Object.assign(new Error("stale"),{code:"WORKFLOW_STALE"});
  const transport=vi.fn().mockRejectedValueOnce(stale).mockResolvedValue({draft:{...item.draft,revision:6}}),onSubmit=vi.fn();
  function Owner(){
   const[currentItem,setItem]=useState(item);
   const[conflict,setConflict]=useState<ComponentProps<typeof DraftEditor>["conflict"]>(null);
   return <DraftEditor item={currentItem} conflict={conflict} onSubmit={onSubmit} onSave={async input=>{
    setConflict(null);
    try{return await transport(input);}catch(error){
     const currentDraft={...item.draft!,revision:5,caption:"Concurrent server input"};
     setItem({...item,draft:currentDraft});setConflict({workItemId:item.id,localDraft:input,currentDraft});throw error;
    }
   }}/>;
  }
  render(<Owner/>);await edit();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save retained draft against latest revision"})));
  await act(async()=>vi.advanceTimersByTimeAsync(2400));
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({revision:5,caption:"Retained local input"}));
  expect(screen.getByLabelText("Caption or copy")).toHaveValue("Retained local input");
  expect(onSubmit).not.toHaveBeenCalled();
 });
 it("keeps queued work bound to its original save handler when the work item changes",async()=>{
  vi.useFakeTimers();let resolveFirst!:(result:{draft:NonNullable<MissionWorkItemView["draft"]>})=>void;
  const first=new Promise<{draft:NonNullable<MissionWorkItemView["draft"]>}>(resolve=>{resolveFirst=resolve;});
  const originalSave=vi.fn().mockReturnValueOnce(first).mockResolvedValue({draft:{...item.draft,revision:5}}),nextSave=vi.fn(),onSubmit=vi.fn();
  const view=render(<DraftEditor item={item} onSave={originalSave} onSubmit={onSubmit}/>);await edit();
  fireEvent.change(screen.getByLabelText("Caption or copy"),{target:{value:"Queued before navigation"}});
  await act(async()=>vi.advanceTimersByTimeAsync(850));
  expect(originalSave).toHaveBeenCalledTimes(1);
  view.rerender(<DraftEditor item={{...item,id:"next-item",draft:{...item.draft!,id:"next-draft",revision:10,caption:"Other saved input"}}} onSave={nextSave} onSubmit={onSubmit}/>);
  await act(async()=>resolveFirst({draft:{...item.draft!,revision:4}}));
  expect(originalSave).toHaveBeenCalledTimes(2);
  expect(originalSave).toHaveBeenLastCalledWith(expect.objectContaining({workItemId:item.id,caption:"Queued before navigation"}));
  expect(nextSave).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Caption or copy")).toHaveValue("Other saved input");
 });
});
