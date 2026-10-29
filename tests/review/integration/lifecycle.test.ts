// Scenario: happy path, full lifecycle (creator + operator), legacy mission flow.
import { describe, expect, it } from "vitest";
import { api, balances, joinAndSubmit, newCreator, newMission, newStaff, notificationTypes } from "../support/fixture";

describe("happy path: signup → onboard → join → submit → approve → credited", () => {
  it("credits points, cash and XP exactly once and notifies the creator", async () => {
    const creator = await newCreator();
    const reviewer = await newStaff("reviewer");
    const mission = newMission({ points: 120, cash: 80 });

    const start = balances(creator.id);
    expect(start.points).toBe(100); // welcome bonus from onboarding/complete

    const sid = await joinAndSubmit(creator, mission.slug);
    const queue = await api("GET", "/admin/submissions?status=submitted", { jwt: reviewer.jwt, ws: null });
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).toContain(sid);

    const approve = await api("POST", `/admin/submissions/${sid}/approve`, { jwt: reviewer.jwt, ws: null, body: { quality_rating: 5 } });
    expect(approve.status).toBe(200);

    const end = balances(creator.id);
    expect(end.points).toBe(start.points + 120);
    expect(end.cash).toBe(start.cash + 80);
    expect(end.xp).toBeGreaterThan(start.xp);
    expect(notificationTypes(creator.id)).toContain("submission_approved");

    // Wallet API reflects the credit.
    const wallet = await api("GET", "/wallet/earnings", { jwt: creator.jwt });
    expect(wallet.status).toBe(200);
    expect(Number(wallet.body.available ?? wallet.body.balance?.available)).toBe(80);

    // Replay of approve is idempotent (no double credit).
    const again = await api("POST", `/admin/submissions/${sid}/approve`, { jwt: reviewer.jwt, ws: null, body: {} });
    expect([200, 400, 409]).toContain(again.status);
    expect(balances(creator.id).points).toBe(end.points);
  });

  it("new creator with no data gets empty, non-error responses", async () => {
    const creator = await newCreator();
    for (const path of ["/missions/my", "/notifications", "/wallet/points/history", "/wallet/earnings/history", "/redemption/history"]) {
      const res = await api("GET", path, { jwt: creator.jwt });
      expect(res.status, path).toBe(200);
    }
  });

  it("[F-006] no withdrawal / payout endpoint exists for creators (probe)", async () => {
    const creator = await newCreator();
    for (const path of ["/wallet/withdraw", "/wallet/payout", "/payouts"]) {
      const res = await api("POST", path, { jwt: creator.jwt, body: { amount: 10 } });
      expect(res.status, path).toBe(404);
    }
  });
});
