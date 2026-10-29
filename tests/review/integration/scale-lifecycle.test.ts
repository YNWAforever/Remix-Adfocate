// Scenarios: empty and scale (1,000+ items), account lifecycle (suspend, delete, session),
// failure mid-flow, and notification / cron behaviour.
import { describe, expect, it } from "vitest";
import { defect, knownBug } from "../support/bug";
import { api, joinAndSubmit, newCreator, newMission, newStaff, newWorkspace, service, sql, q } from "../support/fixture";

/** Seed N synthetic creators each with one `submitted` legacy submission in a fresh workspace. */
function seedQueue(workspaceId: string, missionId: string, n: number) {
  sql(`with u as (
         insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
         select gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-bulk-'||gen_random_uuid()||'@review.test','',now(),now(),now()
         from generate_series(1,${n}) returning id),
       c as (insert into public.creators(id,workspace_id,display_name) select id,${q(workspaceId)},'Bulk KOC' from u returning id)
       insert into public.mission_submissions(mission_id,creator_id,workspace_id,status,content_urls,submitted_at)
       select ${q(missionId)},id,${q(workspaceId)},'submitted',array['https://www.instagram.com/p/bulk/'],now() from c;`);
}

describe("empty and scale", () => {
  it("a brand-new workspace shows empty operator queues without errors", async () => {
    const ws = newWorkspace();
    const op = await newStaff("operator", ws.id);
    for (const path of ["/admin/submissions?status=submitted", "/admin/applications", "/admin/creators/review", "/admin/reward-handoffs", "/admin/active-missions/queue"]) {
      const res = await api("GET", path, { jwt: op.jwt, ws: null });
      expect(res.status, path).toBe(200);
    }
  });

  for (const n of [250, 1100]) {
    knownBug("F-046", `the legacy submissions queue loads with ${n} pending items (fails from ~250: enrichment puts every id in the URL → "URI too long" 500)`, async () => {
      const ws = newWorkspace();
      const op = await newStaff("operator", ws.id);
      const m = newMission({ workspaceId: ws.id, quota: 5000 });
      seedQueue(ws.id, m.id, n);
      expect(Number(sql(`select count(*) from public.mission_submissions where mission_id=${q(m.id)} and status='submitted';`))).toBe(n);
      const res = await api("GET", "/admin/submissions?status=submitted", { jwt: op.jwt, ws: null });
      defect(() => expect(res.status, JSON.stringify(res.body).slice(0, 120)).toBe(200));
      expect(res.body.submissions).toHaveLength(n);
    }, 300000);
  }

  it("the legacy submissions queue still loads at 200 pending items (boundary)", async () => {
    const ws = newWorkspace();
    const op = await newStaff("operator", ws.id);
    const m = newMission({ workspaceId: ws.id, quota: 5000 });
    seedQueue(ws.id, m.id, 200);
    const res = await api("GET", "/admin/submissions?status=submitted", { jwt: op.jwt, ws: null });
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(200);
  }, 300000);

  it("creator review CRM list is server-paginated (25 per page) at scale", async () => {
    const ws = newWorkspace();
    const op = await newStaff("operator", ws.id);
    const m = newMission({ workspaceId: ws.id, quota: 5000 });
    seedQueue(ws.id, m.id, 60);
    const res = await api("GET", "/admin/creators/review", { jwt: op.jwt, ws: null });
    expect(res.status).toBe(200);
    const items = res.body.items ?? res.body.creators ?? res.body.rows ?? [];
    expect(items.length).toBeLessThanOrEqual(25);
  }, 120000);
});

describe("account lifecycle", () => {
  knownBug("F-017", "a suspended creator cannot join new missions", async () => {
    const c = await newCreator();
    sql(`update public.creators set status='suspended' where id=${q(c.id)};`);
    const m = newMission();
    const res = await api("POST", `/missions/${m.slug}/join`, { jwt: c.jwt });
    defect(() => expect(res.status).toBe(403));
  });

  knownBug("F-009", "deleting a creator account who has redeemed a gift succeeds (anonymise, keep ledgers)", async () => {
    const c = await newCreator();
    const gift = sql(`insert into public.redemption_gifts(workspace_id,name,points_cost,stock_qty,stock_remaining,gift_type,status) values ('00000000-0000-0000-0000-0000000000aa','Review voucher',10,1,1,'digital','available') returning id;`);
    sql(`insert into public.redemption_codes(gift_id,workspace_id,code,status,issued_to,issued_at) values (${q(gift)},'00000000-0000-0000-0000-0000000000aa','DEL-1','issued',${q(c.id)},now());`);
    const del = await service.auth.admin.deleteUser(c.id);
    defect(() => expect(del.error).toBeNull());
  });

  it("there is no self-service account deletion or data export endpoint (probe)", async () => {
    const c = await newCreator();
    for (const [method, path] of [["DELETE", "/me"], ["POST", "/me/delete"], ["GET", "/me/export"]] as const) {
      expect((await api(method, path, { jwt: c.jwt })).status, path).toBe(404);
    }
  });

  it("an expired/revoked session is rejected by creator and operator APIs", async () => {
    const c = await newCreator();
    await service.auth.admin.signOut(c.jwt); // revokes refresh tokens; access JWT stays valid until expiry
    const ok = await api("GET", "/me", { jwt: c.jwt });
    expect([200, 401]).toContain(ok.status); // documents Supabase semantics: access tokens live until exp
    const tampered = c.jwt.slice(0, -4) + "AAAA";
    expect((await api("GET", "/me", { jwt: tampered })).status).toBe(401);
  });
});

describe("failure mid-flow", () => {
  it("approval on an insufficient enforced budget fails atomically (no partial credit)", async () => {
    const ws = newWorkspace();
    const op = await newStaff("operator", ws.id);
    const c = await newCreator();
    sql(`update public.creators set workspace_id=${q(ws.id)} where id=${q(c.id)};
         insert into public.point_balances(creator_id,workspace_id,balance) values (${q(c.id)},${q(ws.id)},0) on conflict do nothing;
         insert into public.earnings_balances(creator_id,workspace_id,available) values (${q(c.id)},${q(ws.id)},0) on conflict do nothing;
         insert into public.workspace_budgets(workspace_id,balance,enforced) values (${q(ws.id)},10,true);`);
    const m = newMission({ workspaceId: ws.id, cash: 80, points: 100 });
    sql(`insert into public.mission_submissions(mission_id,creator_id,workspace_id,status,content_urls) values (${q(m.id)},${q(c.id)},${q(ws.id)},'submitted',array['https://www.instagram.com/p/budget/']);`);
    const sid = sql(`select id from public.mission_submissions where mission_id=${q(m.id)};`);
    const res = await api("POST", `/admin/submissions/${sid}/approve`, { jwt: op.jwt, ws: null, body: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sql(`select status from public.mission_submissions where id=${q(sid)};`)).toBe("submitted");
    expect(Number(sql(`select balance from public.point_balances where creator_id=${q(c.id)} and workspace_id=${q(ws.id)};`))).toBe(0);
  });

  knownBug("F-032", "an RPC failure returns a generic message, not the raw database error text", async () => {
    const ws = newWorkspace();
    const op = await newStaff("operator", ws.id);
    const c = await newCreator();
    sql(`update public.creators set workspace_id=${q(ws.id)} where id=${q(c.id)};
         insert into public.point_balances(creator_id,workspace_id,balance) values (${q(c.id)},${q(ws.id)},0) on conflict do nothing;
         insert into public.earnings_balances(creator_id,workspace_id,available) values (${q(c.id)},${q(ws.id)},0) on conflict do nothing;
         insert into public.workspace_budgets(workspace_id,balance,enforced) values (${q(ws.id)},1,true);`);
    const m = newMission({ workspaceId: ws.id, cash: 80 });
    sql(`insert into public.mission_submissions(mission_id,creator_id,workspace_id,status,content_urls) values (${q(m.id)},${q(c.id)},${q(ws.id)},'submitted',array['https://www.instagram.com/p/budget2/']);`);
    const sid = sql(`select id from public.mission_submissions where mission_id=${q(m.id)};`);
    const res = await api("POST", `/admin/submissions/${sid}/approve`, { jwt: op.jwt, ws: null, body: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
    defect(() => expect(res.body.code).not.toBe("rpc_error"));
  });

  knownBug("F-021", "bootstrap reports failure when a balance row cannot be created", async () => {
    const { newUser } = await import("../support/fixture");
    const u = await newUser("bootstrap-fail");
    // Simulate a transient failure of the earnings_balances upsert for this user only.
    sql(`create or replace function public.review_block_earnings() returns trigger language plpgsql as $$ begin if new.creator_id=${q(u.id)} then raise exception 'simulated outage'; end if; return new; end $$;
         drop trigger if exists review_block_earnings on public.earnings_balances;
         create trigger review_block_earnings before insert on public.earnings_balances for each row execute function public.review_block_earnings();`);
    try {
      const res = await api("POST", "/me/bootstrap", { jwt: u.jwt, body: { slug: "demo" }, ws: null });
      const hasRow = Number(sql(`select count(*) from public.earnings_balances where creator_id=${q(u.id)};`));
      expect(hasRow).toBe(0);
      defect(() => expect(res.status).toBeGreaterThanOrEqual(500));
    } finally {
      sql(`drop trigger if exists review_block_earnings on public.earnings_balances; drop function if exists public.review_block_earnings();`);
    }
  });
});

describe("notifications and scheduled jobs", () => {
  it("approval and rejection each create exactly one creator notification", async () => {
    const c = await newCreator();
    const r = await newStaff("reviewer");
    const m1 = newMission(), m2 = newMission();
    const s1 = await joinAndSubmit(c, m1.slug), s2 = await joinAndSubmit(c, m2.slug);
    await api("POST", `/admin/submissions/${s1}/approve`, { jwt: r.jwt, ws: null, body: {} });
    await api("POST", `/admin/submissions/${s2}/reject`, { jwt: r.jwt, ws: null, body: { notes: "n" } });
    const counts = sql(`select type||':'||count(*) from public.notifications where user_id=${q(c.id)} and type like 'submission_%' group by type order by type;`);
    expect(counts.split("\n")).toEqual(["submission_approved:1", "submission_rejected:1"]);
  });

  it("daily cron rejects missing/incorrect secrets and runs with the right one", async () => {
    expect((await api("GET", "/cron/daily", { ws: null })).status).toBe(401);
    expect((await api("GET", "/cron/daily", { ws: null, headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = await api("GET", "/cron/daily", { ws: null, headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    expect(ok.body.errors).toEqual([]);
  });

  knownBug("F-012", "the daily cron emits active-mission deadline reminders", async () => {
    const ok = await api("GET", "/cron/daily", { ws: null, headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    defect(() => expect(Object.keys(ok.body)).toEqual(expect.arrayContaining([expect.stringMatching(/deadline/i)])));
  });
});
