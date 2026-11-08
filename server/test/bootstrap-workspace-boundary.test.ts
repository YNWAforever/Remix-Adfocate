import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const USER = "a0000000-0000-4000-8000-000000000003";
const h = vi.hoisted(() => ({
  validUser: true, email: "boundary@example.invalid", phone: "",
  result: { created: true } as unknown,
  error: null as null | { code: string },
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tables: [] as string[],
}));
vi.mock("../lib/supabase", () => ({
  makeUserClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.validUser ? { id: USER, email: h.email, phone: h.phone } : null } }) },
  }),
  serviceClient: () => ({
    from: (table: string) => {
      h.tables.push(table);
      if (table !== "workspaces") throw new Error("NON_ATOMIC_BOOTSTRAP_FALLBACK");
      let slug = "";
      const q = {
        select: () => q,
        eq: (_key: string, value: string) => { slug = value; return q; },
        single: async () => ({ data: { id: slug === "pilot-b" ? B : A }, error: null }),
      };
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      return { data: h.result, error: h.error };
    },
  }),
}));

import { meBootstrap } from "../routes/me";
const app = new Hono().route("/api/me", meBootstrap);
const bootstrap = (slug = "pilot-a", ref?: string) => app.request("/api/me/bootstrap", {
  method: "POST",
  headers: { Authorization: "Bearer offline-transport-only", "Content-Type": "application/json" },
  body: JSON.stringify({ slug, ref, creatorId: "untrusted-body-identity" }),
});

beforeEach(() => {
  vi.stubEnv("BOOTSTRAP_WORKSPACE_SLUGS", "pilot-a,pilot-b");
  Object.assign(h, { validUser: true, email: "boundary@example.invalid", phone: "", result: { created: true }, error: null, calls: [], tables: [] });
});

describe("bootstrap route and atomic RPC contract (mock transport, no real Auth)", () => {
  it("uses the verified identity and resolved workspace; preserves the repeat-login response", async () => {
    expect(await (await bootstrap()).json()).toEqual({ created: true });
    expect(h.calls).toEqual([{ name: "bootstrap_creator_account", args: {
      p_creator: USER, p_workspace: A, p_display_name: "boundary@example.invalid", p_phone: null, p_ref: null,
    } }]);
    h.result = { created: false };
    expect(await (await bootstrap()).json()).toEqual({ created: false });
    expect(h.tables).toEqual(["workspaces", "workspaces"]);
  });
  it("maps an atomic cross-workspace refusal without a balance-write fallback", async () => {
    h.error = { code: "PT404" };
    const response = await bootstrap("pilot-b");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "no_workspace" });
    expect(h.calls[0].args.p_workspace).toBe(B);
    expect(h.tables).toEqual(["workspaces"]);
  });
  it("maps an anonymised-account refusal with its stable error code", async () => {
    h.error = { code: "PT401" };
    const response = await bootstrap();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "account_deleted" });
  });
  it("fails closed if the new atomic migration is absent", async () => {
    h.error = { code: "PGRST202" };
    const response = await bootstrap();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "bootstrap_incomplete" });
    expect(h.tables).toEqual(["workspaces"]);
  });
  it("returns a recoverable failure when the transaction fails", async () => {
    h.error = { code: "XX000" };
    expect((await bootstrap()).status).toBe(503);
    expect(h.calls).toHaveLength(1);
  });
  it("rejects a malformed RPC result instead of reporting success", async () => {
    h.result = { created: "true" };
    expect((await bootstrap()).status).toBe(503);
  });
  it("requires an authenticated user before the privileged call", async () => {
    h.validUser = false;
    expect((await bootstrap()).status).toBe(401);
    expect(h.calls).toEqual([]);
    expect(h.tables).toEqual([]);
  });
  it("preserves the workspace allowlist before the privileged call", async () => {
    expect((await bootstrap("demo")).status).toBe(404);
    expect(h.calls).toEqual([]);
  });
  it("preserves the phone-primary display name and E.164 formatting", async () => {
    h.email = ""; h.phone = "85255550123";
    expect((await bootstrap()).status).toBe(200);
    expect(h.calls[0].args).toMatchObject({ p_display_name: "+85255550123", p_phone: "+85255550123" });
  });
  it("ignores an empty referral and forwards a non-empty referral for atomic resolution", async () => {
    expect((await bootstrap("pilot-a", "")).status).toBe(200);
    expect(h.calls[0].args.p_ref).toBeNull();
    expect((await bootstrap("pilot-a", "REFERRAL8")).status).toBe(200);
    expect(h.calls[1].args.p_ref).toBe("REFERRAL8");
  });
});
