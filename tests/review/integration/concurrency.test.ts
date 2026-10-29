// Scenario: concurrency — double submit, edit while under review, two operators on one item,
// stale admin edits.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, balances, joinAndSubmit, newCreator, newMission, newStaff, sql, q, VALID_URLS } from "../support/fixture";

describe("creator double actions", () => {
  it("double join and double submit (parallel) create one submission and award submit XP once", async () => {
    const c = await newCreator();
    const m = newMission();
    const joins = await Promise.all([1, 2, 3].map(() => api("POST", `/missions/${m.slug}/join`, { jwt: c.jwt })));
    expect(joins.filter(r => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(Number(sql(`select count(*) from public.mission_submissions where mission_id=${q(m.id)} and creator_id=${q(c.id)};`))).toBe(1);
    expect(Number(sql(`select filled from public.missions where id=${q(m.id)};`))).toBe(1);
    const xpBefore = balances(c.id).xp;
    const subs = await Promise.all([1, 2, 3].map(() => api("PUT", `/missions/${m.slug}/submit`, { jwt: c.jwt, body: { content_urls: VALID_URLS } })));
    expect(subs.some(r => r.status === 200)).toBe(true);
    expect(balances(c.id).xp - xpBefore).toBe(25);
  });

  it("editing (re-submitting) while under review is refused and does not change the evidence", async () => {
    const c = await newCreator();
    const m = newMission();
    const sid = await joinAndSubmit(c, m.slug);
    const res = await api("PUT", `/missions/${m.slug}/submit`, { jwt: c.jwt, body: { content_urls: ["https://www.instagram.com/p/changed/"] } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sql(`select content_urls::text from public.mission_submissions where id=${q(sid)};`)).toContain("review123");
  });

  it("joining a mission at quota from many creators never overfills", async () => {
    const m = newMission({ quota: 2 });
    const creators = await Promise.all([1, 2, 3, 4, 5].map(() => newCreator()));
    await Promise.all(creators.map(c => api("POST", `/missions/${m.slug}/join`, { jwt: c.jwt })));
    expect(Number(sql(`select filled from public.missions where id=${q(m.id)};`))).toBeLessThanOrEqual(2);
    expect(Number(sql(`select count(*) from public.mission_submissions where mission_id=${q(m.id)};`))).toBeLessThanOrEqual(2);
  });

  it("redeeming the same gift with the same client_request_id twice debits once", async () => {
    const c = await newCreator();
    const gift = sql(`insert into public.redemption_gifts(workspace_id,name,points_cost,stock_qty,stock_remaining,gift_type,status) values ('00000000-0000-0000-0000-0000000000aa','Review voucher',50,5,5,'digital','available') returning id;`);
    sql(`insert into public.redemption_codes(gift_id,workspace_id,code) select ${q(gift)},'00000000-0000-0000-0000-0000000000aa','RV-'||g from generate_series(1,5) g;`);
    const id = randomUUID();
    const [a, b] = await Promise.all([1, 2].map(() => api("POST", "/redemption/redeem", { jwt: c.jwt, body: { gift_id: gift, client_request_id: id } })));
    expect([a.status, b.status]).toContain(200);
    expect(balances(c.id).points).toBe(50);
    expect(Number(sql(`select count(*) from public.redemption_codes where gift_id=${q(gift)} and issued_to=${q(c.id)};`))).toBe(1);
  });
});

describe("two operators on the same item", () => {
  it("parallel approvals by two reviewers credit the creator exactly once", async () => {
    const c = await newCreator();
    const [r1, r2] = await Promise.all([newStaff("reviewer"), newStaff("reviewer")]);
    const m = newMission({ points: 200, cash: 50 });
    const sid = await joinAndSubmit(c, m.slug);
    const before = balances(c.id);
    await Promise.all([r1, r2].map(r => api("POST", `/admin/submissions/${sid}/approve`, { jwt: r.jwt, ws: null, body: {} })));
    const after = balances(c.id);
    expect(after.points - before.points).toBe(200);
    expect(after.cash - before.cash).toBe(50);
    expect(Number(sql(`select count(*) from public.earnings_transactions where creator_id=${q(c.id)};`))).toBe(1);
  });

  it("approve vs reject race leaves a consistent final state (credit iff approved)", async () => {
    const c = await newCreator();
    const [r1, r2] = await Promise.all([newStaff("reviewer"), newStaff("reviewer")]);
    const m = newMission({ points: 100 });
    const sid = await joinAndSubmit(c, m.slug);
    const before = balances(c.id).points;
    await Promise.all([
      api("POST", `/admin/submissions/${sid}/approve`, { jwt: r1.jwt, ws: null, body: {} }),
      api("POST", `/admin/submissions/${sid}/reject`, { jwt: r2.jwt, ws: null, body: { notes: "race" } }),
    ]);
    const status = sql(`select status from public.mission_submissions where id=${q(sid)};`);
    expect(["approved", "rejected"]).toContain(status);
    expect(balances(c.id).points - before).toBe(status === "approved" ? 100 : 0);
  });

  it("[F-004 fixed] the losing operator in an approve/reject race is told the item changed (409), not a raw 400 RPC message", async () => {
    const c = await newCreator();
    const [r1, r2] = await Promise.all([newStaff("reviewer"), newStaff("reviewer")]);
    const m = newMission();
    const sid = await joinAndSubmit(c, m.slug);
    await api("POST", `/admin/submissions/${sid}/approve`, { jwt: r1.jwt, ws: null, body: {} });
    const late = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: r2.jwt, ws: null, body: { notes: "late" } });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("wrong_state");
  });

  it("[F-022 fixed] a stale mission edit is rejected instead of silently overwriting a newer one", async () => {
    const admin = await newStaff("workspace_admin");
    const m = newMission({ status: "draft" });
    const original = sql(`select updated_at from public.missions where id=${q(m.id)};`);
    const first = await api("PATCH", `/admin/missions/${m.id}`, { jwt: admin.jwt, ws: null, body: { title: "Edit from tab A" } });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const stale = await api("PATCH", `/admin/missions/${m.id}`, { jwt: admin.jwt, ws: null, body: { title: "Edit from tab B", updated_at: original, expected_updated_at: original } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_EDIT");
    expect(sql(`select title from public.missions where id=${q(m.id)};`)).toBe("Edit from tab A");
    // A save based on the current version still succeeds.
    const current = sql(`select updated_at from public.missions where id=${q(m.id)};`);
    const fresh = await api("PATCH", `/admin/missions/${m.id}`, { jwt: admin.jwt, ws: null, body: { title: "Edit from tab B", expected_updated_at: current } });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
  });

  it("[F-022 fixed] stale campaign edits conflict and a double publish broadcasts once", async () => {
    const admin = await newStaff("workspace_admin");
    const slug = `review-camp-${randomUUID().slice(0, 6)}`;
    const id = sql(`insert into public.campaigns(workspace_id,slug,title,status,starts_at,ends_at,goal_metric,goal_target)
      values ('00000000-0000-0000-0000-0000000000aa',${q(slug)},'Review campaign','draft',now(),now()+interval '30 days','approved_submissions',5) returning id;`);
    sql(`update public.campaigns set completion_bonus_points=50 where id=${q(id)};`);
    const original = sql(`select updated_at from public.campaigns where id=${q(id)};`);
    const a = await api("PATCH", `/admin/campaigns/${id}`, { jwt: admin.jwt, ws: null, body: { title: "Tab A", expected_updated_at: original } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await api("PATCH", `/admin/campaigns/${id}`, { jwt: admin.jwt, ws: null, body: { title: "Tab B", expected_updated_at: original } });
    expect(b.status).toBe(409);
    expect(sql(`select title from public.campaigns where id=${q(id)};`)).toBe("Tab A");
    const creator = await newCreator();
    const pubs = await Promise.all([1, 2, 3].map(() => api("POST", `/admin/campaigns/${id}/publish`, { jwt: admin.jwt, ws: null })));
    expect(pubs.filter(r => r.status === 200), JSON.stringify(pubs.map(r => [r.status, r.body]))).toHaveLength(1);
    expect(Number(sql(`select count(*) from public.notifications where user_id=${q(creator.id)} and type='campaign_started';`))).toBeLessThanOrEqual(1);
  });
});
