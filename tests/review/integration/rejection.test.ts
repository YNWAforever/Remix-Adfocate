// Scenario: rejection and resubmission; notifications on each status change.
import { describe, expect, it } from "vitest";
import { defect, knownBug } from "../support/bug";
import { randomUUID } from "node:crypto";
import { api, joinAndSubmit, newCreator, newMission, newStaff, notificationTypes, sql, q, VALID_URLS } from "../support/fixture";

describe("operator rejects / requests changes; creator sees reason and recovers", () => {
  it("[F-004 fixed] reject without a reason is refused (400)", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    const res = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: {} });
    expect(res.status).toBe(400);
    const blank = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: { notes: "   " } });
    expect(blank.status).toBe(400);
    expect(sql(`select status from public.mission_submissions where id=${q(sid)};`)).toBe("submitted");
  });

  knownBug("F-004", "approve/reject records the acting operator in an audit trail", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    const res = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: { notes: "Off brief" } });
    expect(res.status).toBe(200);
    const audited = sql(`select count(*) from public.operator_audit_events where operator_id=${q(reviewer.id)};`);
    defect(() => expect(Number(audited)).toBeGreaterThan(0));
  });

  it("rejection notifies the creator and keeps the reviewer note on the row", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    const res = await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: { notes: "畫面太暗，請重拍 (too dark)" } });
    expect(res.status).toBe(200);
    expect(notificationTypes(creator.id)).toContain("submission_rejected");
    const mine = await api("GET", "/missions/my", { jwt: creator.jwt });
    expect(JSON.stringify(mine.body)).toContain("畫面太暗");
  });

  knownBug("F-010", "a rejected creator can resubmit corrected work", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    await api("POST", `/admin/submissions/${sid}/reject`, { jwt: reviewer.jwt, ws: null, body: { notes: "fix lighting" } });
    const rej = await api("GET", "/missions/my", { jwt: creator.jwt });
    expect(JSON.stringify(rej.body)).toContain("rejected");
    const resubmit = await api("PUT", `/missions/${m.slug}/submit`, { jwt: creator.jwt, body: { content_urls: ["https://www.instagram.com/p/review456/"] } });
    defect(() => expect(resubmit.status).toBe(200));
  });

  it("request-correction returns the work to the creator, who can resubmit", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    // Corrections are only offered for invalid stored evidence; simulate a legacy bad URL row.
    sql(`alter table public.mission_submissions disable trigger user; update public.mission_submissions set content_urls=array['not a url'] where id=${q(sid)}; alter table public.mission_submissions enable trigger user;`);
    const rev = Number(sql(`select evidence_revision from public.mission_submissions where id=${q(sid)};`));
    const corr = await api("POST", `/admin/submissions/${sid}/request-correction`, { jwt: reviewer.jwt, ws: null, body: { note: "Link is broken", request_id: randomUUID(), expected_revision: rev } });
    expect(corr.status, JSON.stringify(corr.body)).toBe(200);
    expect(sql(`select status from public.mission_submissions where id=${q(sid)};`)).toBe("joined");
    const resubmit = await api("PUT", `/missions/${m.slug}/submit`, { jwt: creator.jwt, body: { content_urls: VALID_URLS } });
    expect(resubmit.status).toBe(200);
  });

  knownBug("F-012", "request-correction notifies the creator", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const m = newMission();
    const sid = await joinAndSubmit(creator, m.slug);
    sql(`alter table public.mission_submissions disable trigger user; update public.mission_submissions set content_urls=array['not a url'] where id=${q(sid)}; alter table public.mission_submissions enable trigger user;`);
    const rev = Number(sql(`select evidence_revision from public.mission_submissions where id=${q(sid)};`));
    const before = notificationTypes(creator.id).length;
    const corr = await api("POST", `/admin/submissions/${sid}/request-correction`, { jwt: reviewer.jwt, ws: null, body: { note: "Link is broken", request_id: randomUUID(), expected_revision: rev } });
    expect(corr.status).toBe(200);
    defect(() => expect(notificationTypes(creator.id).length).toBeGreaterThan(before));
  });

  it("application: decline requires a reason; accept notifies; first decision wins", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("operator");
    const m = newMission({ access: "application" });
    const apply = await api("POST", `/missions/${m.slug}/apply`, { jwt: creator.jwt });
    expect(apply.status).toBe(200);
    const id = sql(`select id from public.mission_submissions where mission_id=${q(m.id)} and creator_id=${q(creator.id)};`);
    const noReason = await api("POST", `/admin/applications/${id}/decline`, { jwt: reviewer.jwt, ws: null, body: { request_id: randomUUID() } });
    expect(noReason.status).toBe(400);
    const accept = await api("POST", `/admin/applications/${id}/accept`, { jwt: reviewer.jwt, ws: null, body: { request_id: randomUUID() } });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const late = await api("POST", `/admin/applications/${id}/decline`, { jwt: reviewer.jwt, ws: null, body: { request_id: randomUUID(), notes: "late" } });
    expect(late.status).toBe(409);
    expect(notificationTypes(creator.id)).toContain("application_accepted");
  });
});
