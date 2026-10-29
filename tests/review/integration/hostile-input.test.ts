// Scenario: invalid / hostile input — oversized, wrong types, XSS, Unicode / Chinese text,
// on creator and admin forms; plus the public passport privacy leak.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { defect, knownBug } from "../support/bug";
import { api, newCreator, newMission, newUser, sql, q } from "../support/fixture";

const XSS = `<img src=x onerror="alert(document.cookie)"><script>alert(1)</script>`;

describe("creator inputs", () => {
  it("Chinese, emoji and mixed-script display names round-trip intact", async () => {
    const c = await newCreator();
    const name = "陳大文 Tai Man 🌸 小紅書KOC";
    const put = await api("PUT", "/me/profile", { jwt: c.jwt, body: { display_name: name } });
    expect(put.status).toBe(200);
    const me = await api("GET", "/me", { jwt: c.jwt });
    expect(JSON.stringify(me.body)).toContain(name);
  });

  it("XSS payloads are stored as inert text and returned as JSON strings (rendering relies on React escaping)", async () => {
    const c = await newCreator();
    const put = await api("PUT", "/me/profile", { jwt: c.jwt, body: { display_name: XSS } });
    expect(put.status).toBe(200);
    const me = await api("GET", "/me", { jwt: c.jwt });
    expect(typeof me.body).toBe("object"); // JSON, never HTML
  });

  knownBug("F-028", "a 100,000-character display name is rejected", async () => {
    const c = await newCreator();
    const put = await api("PUT", "/me/profile", { jwt: c.jwt, body: { display_name: "長".repeat(100_000) } });
    defect(() => expect(put.status).toBe(400));
  });

  knownBug("F-028", "malformed JSON on submit returns 400, not 500", async () => {
    const c = await newCreator();
    const m = newMission();
    await api("POST", `/missions/${m.slug}/join`, { jwt: c.jwt });
    const { createApp } = await import("../../../server/app.js");
    const res = await createApp().app.request("http://local/api/missions/" + m.slug + "/submit", {
      method: "PUT", body: "{not json", headers: { Authorization: `Bearer ${c.jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json" },
    });
    defect(() => expect(res.status).toBe(400));
  });

  it("evidence URLs: javascript:, credentials, empty and non-URL values are rejected", async () => {
    const c = await newCreator();
    const m = newMission();
    await api("POST", `/missions/${m.slug}/join`, { jwt: c.jwt });
    for (const bad of [["javascript:alert(1)"], ["https://user:pass@instagram.com/p/x"], [""], ["not a url"], []]) {
      const res = await api("PUT", `/missions/${m.slug}/submit`, { jwt: c.jwt, body: { content_urls: bad } });
      expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("avatar upload grant rejects SVG/HTML types and files over 5 MB", async () => {
    const c = await newCreator();
    const svg = await api("POST", "/me/profile-media/avatar-upload", { jwt: c.jwt, body: { fileName: "a.svg", contentType: "image/svg+xml", sizeBytes: 1000 } });
    expect(svg.status).toBeGreaterThanOrEqual(400);
    const html = await api("POST", "/me/profile-media/avatar-upload", { jwt: c.jwt, body: { fileName: "a.html", contentType: "text/html", sizeBytes: 1000 } });
    expect(html.status).toBeGreaterThanOrEqual(400);
    const big = await api("POST", "/me/profile-media/avatar-upload", { jwt: c.jwt, body: { fileName: "a.png", contentType: "image/png", sizeBytes: 50 * 1024 * 1024 } });
    expect(big.status).toBeGreaterThanOrEqual(400);
  });

  it("portfolio links reject non-http(s) schemes", async () => {
    const c = await newCreator();
    const res = await api("POST", "/me/profile-media/portfolio", { jwt: c.jwt, body: { platform: "instagram", url: "javascript:alert(1)", title: "x" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("public passport privacy", () => {
  knownBug("F-002", "a shared passport never exposes the creator's email address", async () => {
    const c = await newCreator(); // display_name defaults to the sign-up email (server/routes/me.ts:75)
    const share = await api("POST", "/me/passport/share", { jwt: c.jwt });
    expect(share.status, JSON.stringify(share.body)).toBe(200);
    const token = (share.body.token ?? share.body.share?.token ?? share.body.url?.split("/").pop()) as string;
    expect(token).toBeTruthy();
    const pub = await api("GET", `/public/passports/${token}`, { ws: null });
    expect(pub.status).toBe(200);
    defect(() => expect(JSON.stringify(pub.body)).not.toContain(c.email));
  });
});

describe("admin forms", () => {
  async function contentEditor() {
    const u = await newUser("content-editor");
    sql(`insert into public.staff_users(user_id,email,active) values (${q(u.id)},${q(u.email)},true);
         select private.bootstrap_staff_access(${q(u.id)},null,${q(u.id)},'content_editor',true,0,${q(randomUUID())},'review fixture','review-local-disposable');`);
    return u;
  }

  it("admin mission create rejects negative rewards and XSS-only titles are stored as text", async () => {
    const { newStaff } = await import("../support/fixture");
    const admin = await newStaff("workspace_admin");
    const neg = await api("POST", "/admin/missions", { jwt: admin.jwt, ws: null, body: { title: "Neg", points_reward: -100, cash_reward: -5, mission_type: "ugc", access_type: "open" } });
    expect(neg.status).toBeGreaterThanOrEqual(400);
    expect(neg.status).toBeLessThan(500);
    const xss = await api("POST", "/admin/missions", { jwt: admin.jwt, ws: null, body: { title: XSS, mission_type: "ugc", access_type: "open", points_reward: 10 } });
    expect([200, 201, 400, 422]).toContain(xss.status);
  });

  knownBug("F-014", "content media upload refuses HTML files", async () => {
    const editor = await contentEditor();
    const { createApp } = await import("../../../server/app.js");
    const form = new FormData();
    form.append("file", new File(["<script>alert(1)</script>"], "evil.html", { type: "text/html" }));
    const res = await createApp().app.request("http://local/api/admin/content/media", { method: "POST", body: form, headers: { Authorization: `Bearer ${editor.jwt}` } });
    expect(res.status).not.toBe(403); // the editor really is authorised; the gap is validation
    defect(() => expect(res.status).toBeGreaterThanOrEqual(400));
  });

  it("application decline reason is capped at 500 characters (Chinese counted by code point)", async () => {
    const { newStaff } = await import("../support/fixture");
    const op = await newStaff("operator");
    const c = await newCreator();
    const m = newMission({ access: "application" });
    await api("POST", `/missions/${m.slug}/apply`, { jwt: c.jwt });
    const id = sql(`select id from public.mission_submissions where mission_id=${q(m.id)};`);
    const res = await api("POST", `/admin/applications/${id}/decline`, { jwt: op.jwt, ws: null, body: { notes: "拒".repeat(501) } });
    expect(res.status).toBe(400);
  });
});
