import {act,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({api:vi.fn()}));
vi.mock("@/lib/api",async original=>({...await original<object>(),apiFetch:h.api}));
import {useSubmitMissionWorkItem} from "./activeMission";
import {setActivationAnalyticsSink} from "../activationAnalytics";
const id="123e4567-e89b-42d3-a456-426614174000";
afterEach(()=>{setActivationAnalyticsSink(null);vi.clearAllMocks();});
function hook(){const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});return renderHook(()=>useSubmitMissionWorkItem("submission"),{wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
it("D17 draft submission emits a business outcome only after the returned saved version identifies the work item",async()=>{
 const events:unknown[]=[];setActivationAnalyticsSink(e=>{events.push(e);return true;});
 let finish!:(value:unknown)=>void;h.api.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const {result,rerender}=hook();rerender();expect(events).toEqual([]);
 act(()=>result.current.mutate({workItemId:id,expectedRevision:0,idempotencyKey:"owned-request"}));expect(events).toEqual([]);
 await act(async()=>finish({version:{id:"saved-version",mission_work_item_id:id,version_number:3},workItem:{id}}));
 await waitFor(()=>expect(result.current.isSuccess).toBe(true));
 expect(events).toEqual([{name:"product_action_result",properties:{entityId:id,action:"draft_submit",revision:3,result:"saved"}}]);
});
it("D17 an HTTP success without a saved version never counts as completed work",async()=>{
 const events:unknown[]=[];setActivationAnalyticsSink(e=>{events.push(e);return true;});h.api.mockResolvedValue({version:null,workItem:null});const {result}=hook();
 await act(async()=>{await result.current.mutateAsync({workItemId:id,expectedRevision:0,idempotencyKey:"owned-request"});});expect(events).toEqual([]);
});
it("D17 a zero version is not a persisted draft outcome",async()=>{
 const events:unknown[]=[];setActivationAnalyticsSink(e=>{events.push(e);return true;});h.api.mockResolvedValue({version:{mission_work_item_id:id,version_number:0},workItem:{id}});const {result}=hook();
 await act(async()=>{await result.current.mutateAsync({workItemId:id,expectedRevision:0,idempotencyKey:"owned-request"});});expect(events).toEqual([]);
});
