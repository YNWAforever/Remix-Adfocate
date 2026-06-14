import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeUser, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function bootstrap(jwt: string) {
  return app.request("/api/me/bootstrap", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "demo" }),
  });
}
function getMe(jwt: string) {
  return app.request("/api/me", {
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" },
  });
}

suite("bootstrap (first login)", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates an email creator and returns created:true, then false on repeat", async () => {
    const user = await makeUser({ email: "boot@test.local" });
    const first = await bootstrap(user.jwt);
    expect(first.status).toBe(200);
    expect((await first.json()).created).toBe(true);

    const second = await bootstrap(user.jwt);
    expect((await second.json()).created).toBe(false);

    const me = await getMe(user.jwt);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.display_name).toBe("boot@test.local");
    expect(body.onboarding_completed).toBe(false);
    expect(body.referral_code).toMatch(/^[0-9A-F]{8}$/);
  });

  it("creates a PHONE-primary creator with no email (display_name = E.164)", async () => {
    const user = await makeUser({ phone: "+15555550100" });
    const res = await bootstrap(user.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(true);

    const me = await getMe(user.jwt);
    const body = await me.json();
    expect(body.phone).toBe("+15555550100");
    expect(body.display_name).toBe("+15555550100");
    expect(body.onboarding_completed).toBe(false);
  });
});
