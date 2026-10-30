// Scenario: privacy and compliance — consent capture (F-008).
import { describe, expect, it } from "vitest";
import { api, newCreator, sql, q } from "../support/fixture";
import { LEGAL_VERSIONS } from "../../../src/lib/legalVersions";

describe("consent capture (F-008)", () => {
  it("[F-008 fixed] a new creator must accept the current Terms and Privacy Policy; acceptance is recorded with versions", async () => {
    const c = await newCreator({ consent: false });
    const before = await api("GET", "/me/consents", { jwt: c.jwt });
    expect(before.status).toBe(200);
    expect(before.body.needsAcceptance).toBe(true);
    const stale = await api("POST", "/me/consents", { jwt: c.jwt, body: { terms_version: "2020-01", privacy_version: LEGAL_VERSIONS.privacy } });
    expect(stale.status).toBe(409);
    const ok = await api("POST", "/me/consents", { jwt: c.jwt, body: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, marketing: false } });
    expect(ok.status).toBe(200);
    const after = await api("GET", "/me/consents", { jwt: c.jwt });
    expect(after.body.needsAcceptance).toBe(false);
    expect(after.body.terms.version).toBe(LEGAL_VERSIONS.terms);
    expect(sql(`select string_agg(document||':'||version||':'||granted, ',' order by document) from public.creator_consents where creator_id=${q(c.id)};`))
      .toBe(`marketing:${LEGAL_VERSIONS.terms}:false,privacy:${LEGAL_VERSIONS.privacy}:true,terms:${LEGAL_VERSIONS.terms}:true`);
  });

  it("marketing consent can be withdrawn later and the history is append-only", async () => {
    const c = await newCreator();
    expect((await api("POST", "/me/consents/marketing", { jwt: c.jwt, body: { granted: true } })).status).toBe(200);
    expect((await api("POST", "/me/consents/marketing", { jwt: c.jwt, body: { granted: false } })).status).toBe(200);
    expect((await api("GET", "/me/consents", { jwt: c.jwt })).body.marketing.granted).toBe(false);
    expect(Number(sql(`select count(*) from public.creator_consents where creator_id=${q(c.id)} and document='marketing';`))).toBe(2);
    // Creators cannot write or rewrite consent rows directly.
    const forged = await c.client.from("creator_consents").insert({ creator_id: c.id, workspace_id: "00000000-0000-0000-0000-0000000000aa", document: "terms", version: "1999", granted: true });
    expect(forged.error).not.toBeNull();
    expect(() => sql(`update public.creator_consents set version='x' where creator_id=${q(c.id)};`)).toThrow(/immutable_record/);
  });
});
