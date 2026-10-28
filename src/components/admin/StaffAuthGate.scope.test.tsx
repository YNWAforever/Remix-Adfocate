import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
type AuthSession = { access_token: string; user: { id: string } } | null;
type AuthCallback = (event: string, session: AuthSession) => void;
const h=vi.hoisted(()=>({session:vi.fn(),callback:null as null | AuthCallback}));
vi.mock("@/lib/supabase",()=>({supabase:{auth:{getSession:h.session,onAuthStateChange:(callback:AuthCallback)=>{
  h.callback=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};}}}}));
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"en",t:(key:string)=>key})}));
import { StaffAuthGate } from "./StaffAuthGate";
beforeEach(()=>{vi.clearAllMocks();h.callback=null;});
afterEach(()=>{vi.unstubAllGlobals();});
it("discards a late response body after sign-out and clears identity-owned caches",async()=>{
  let resolveBody!:(value:unknown)=>void;
  const body=new Promise((resolve)=>resolveBody=resolve);
  const fetch=vi.fn(async()=>({status:200,json:()=>body}));vi.stubGlobal("fetch",fetch);
  h.session.mockResolvedValueOnce({data:{session:{access_token:"synthetic"}},error:null})
    .mockResolvedValue({data:{session:null},error:null});
  const changed=vi.fn();render(<StaffAuthGate onIdentityChange={changed}>{(staff)=><p>Private {staff.userId}</p>}</StaffAuthGate>);
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
  await act(async()=>{h.callback!("SIGNED_OUT", null);});expect(changed).toHaveBeenCalledTimes(1);
  await act(async()=>{resolveBody({staff:{userId:"old-staff",email:"synthetic@example.test",active:true}});});
  expect(screen.queryByText("Private old-staff")).not.toBeInTheDocument();
});

it.each(["TOKEN_REFRESHED", "SIGNED_IN", "USER_UPDATED"])("preserves unsaved staff input and cached reads on same-user %s", async (event) => {
  const session = { access_token: "synthetic", user: { id: "staff-a" } };
  h.session.mockResolvedValue({ data: { session }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ staff: { userId: "staff-a" } }), { status: 200 })));
  const changed = vi.fn();
  render(<StaffAuthGate onIdentityChange={changed}>{() => <input aria-label="Unsaved review" defaultValue="" />}</StaffAuthGate>);
  const input = await screen.findByRole("textbox", { name: "Unsaved review" });
  fireEvent.change(input, { target: { value: "Retain my review draft" } });

  await act(async () => { h.callback!(event, session); });

  expect(await screen.findByRole("textbox", { name: "Unsaved review" })).toBe(input);
  expect(input).toHaveValue("Retain my review draft");
  expect(changed).not.toHaveBeenCalled();
});

it("hides the previous staff view immediately when the account changes", async () => {
  h.session.mockResolvedValue({ data: { session: { access_token: "a", user: { id: "staff-a" } } }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ staff: { userId: "staff-a" } }), { status: 200 })));
  const changed = vi.fn();
  render(<StaffAuthGate onIdentityChange={changed}>{staff => <p>Private {staff.userId}</p>}</StaffAuthGate>);
  await screen.findByText("Private staff-a");
  h.session.mockReturnValue(new Promise(() => {}));

  await act(async () => { h.callback!("SIGNED_IN", { access_token: "b", user: { id: "staff-b" } }); });

  expect(screen.queryByText("Private staff-a")).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledTimes(1);
});

it("revalidates staff access during same-user token refresh", async () => {
  const session = { access_token: "synthetic", user: { id: "staff-a" } };
  h.session.mockResolvedValue({ data: { session }, error: null });
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ staff: { userId: "staff-a" } }), { status: 200 }))
    .mockResolvedValue(new Response("{}", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  render(<StaffAuthGate>{staff => <p>Private {staff.userId}</p>}</StaffAuthGate>);
  await screen.findByText("Private staff-a");

  await act(async () => { h.callback!("TOKEN_REFRESHED", session); });

  expect(await screen.findByRole("alert")).toHaveTextContent("app.admin.notStaff");
  expect(screen.queryByText("Private staff-a")).not.toBeInTheDocument();
});

it.each(["response", "transport", "session"])("retains unsaved input through a same-user %s outage and explicit retry", async (failure) => {
  const session = { access_token: "synthetic", user: { id: "staff-a" } };
  h.session.mockResolvedValue({ data: { session }, error: null });
  const fetch = vi.fn().mockImplementation(async () => Response.json({ staff: { userId: "staff-a" } }));
  vi.stubGlobal("fetch", fetch);
  const changed = vi.fn();
  render(<StaffAuthGate onIdentityChange={changed}>{() => <input aria-label="Unsaved review" defaultValue="" />}</StaffAuthGate>);
  const input = await screen.findByRole("textbox", { name: "Unsaved review" });
  fireEvent.change(input, { target: { value: "Retain my review draft" } });
  if (failure === "response") fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  else if (failure === "transport") fetch.mockRejectedValueOnce(new TypeError("Offline"));
  else h.session.mockRejectedValueOnce(new Error("Session unavailable"));

  await act(async () => { h.callback!("TOKEN_REFRESHED", session); });
  await screen.findByRole("alert");
  expect(screen.queryByRole("textbox", { name: "Unsaved review" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByRole("textbox", { name: "Unsaved review" })).toBe(input);
  expect(input).toHaveValue("Retain my review draft");
  expect(changed).not.toHaveBeenCalled();
});

it.each([401, 403])("does not restore a retained view after a definitive %s denial followed by an outage", async (status) => {
  const session = { access_token: "synthetic", user: { id: "staff-a" } };
  h.session.mockResolvedValue({ data: { session }, error: null });
  const fetch = vi.fn().mockImplementation(async () => Response.json({ staff: { userId: "staff-a" } }));
  vi.stubGlobal("fetch", fetch);
  render(<StaffAuthGate>{() => <input aria-label="Unsaved review" defaultValue="Private draft" />}</StaffAuthGate>);
  const input = await screen.findByRole("textbox", { name: "Unsaved review" });

  fetch.mockResolvedValueOnce(new Response("{}", { status }));
  await act(async () => { h.callback!("TOKEN_REFRESHED", session); });
  expect(input).not.toBeInTheDocument();

  fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  await act(async () => { h.callback!("TOKEN_REFRESHED", session); });
  await screen.findByRole("alert");
  expect(input).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Unsaved review")).not.toBeInTheDocument();
});
