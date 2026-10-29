import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { LEGAL_VERSIONS, MARKETING_CONSENT_VERSION } from "../../src/lib/legalVersions.js";

// F-008: Terms / Privacy (PICS) acceptance and marketing consent, appended to creator_consents.
export const consentRoutes = new Hono<Env>();

type ConsentRow = { document: "terms" | "privacy" | "marketing"; version: string; granted: boolean; recorded_at: string };

consentRoutes.get("/", async (c) => {
  // RLS: creators read only their own rows.
  const { data, error } = await makeUserClient(c.get("jwt"))
    .from("creator_consents")
    .select("document, version, granted, recorded_at")
    .eq("creator_id", c.get("userId"))
    .order("recorded_at", { ascending: false });
  if (error) return dbError(c, error, "db_error", 500);
  const latest = (doc: ConsentRow["document"]) => (data as ConsentRow[] | null)?.find((r) => r.document === doc) ?? null;
  const terms = latest("terms"), privacy = latest("privacy"), marketing = latest("marketing");
  return c.json({
    required: LEGAL_VERSIONS,
    terms: terms && { version: terms.version, acceptedAt: terms.recorded_at },
    privacy: privacy && { version: privacy.version, acceptedAt: privacy.recorded_at },
    marketing: { granted: marketing?.granted ?? false, recordedAt: marketing?.recorded_at ?? null },
    needsAcceptance: terms?.version !== LEGAL_VERSIONS.terms || privacy?.version !== LEGAL_VERSIONS.privacy,
  });
});

/** Accept the current Terms and Privacy Policy (versions must match what was shown). */
consentRoutes.post("/", async (c) => {
  const body = await c.req.json<{ terms_version?: unknown; privacy_version?: unknown; marketing?: unknown }>();
  if (body.terms_version !== LEGAL_VERSIONS.terms || body.privacy_version !== LEGAL_VERSIONS.privacy) {
    return c.json({ error: "條款已更新，請重新閱讀 / The documents changed; please review the latest versions", code: "consent_version_mismatch", required: LEGAL_VERSIONS }, 409);
  }
  if (body.marketing !== undefined && typeof body.marketing !== "boolean") {
    return c.json({ error: "marketing must be true or false", code: "bad_request" }, 400);
  }
  const base = { creator_id: c.get("userId"), workspace_id: c.get("workspaceId") };
  const rows = [
    { ...base, document: "terms", version: LEGAL_VERSIONS.terms, granted: true },
    { ...base, document: "privacy", version: LEGAL_VERSIONS.privacy, granted: true },
    ...(typeof body.marketing === "boolean" ? [{ ...base, document: "marketing", version: MARKETING_CONSENT_VERSION, granted: body.marketing }] : []),
  ];
  const { error } = await serviceClient().from("creator_consents").insert(rows);
  if (error) return dbError(c, error, "db_error", 500);
  return c.json({ accepted: true, required: LEGAL_VERSIONS });
});

/** Grant or withdraw marketing consent at any time (the legal copy promises withdrawal). */
consentRoutes.post("/marketing", async (c) => {
  const body = await c.req.json<{ granted?: unknown }>();
  if (typeof body.granted !== "boolean") return c.json({ error: "granted must be true or false", code: "bad_request" }, 400);
  const { error } = await serviceClient().from("creator_consents").insert({
    creator_id: c.get("userId"), workspace_id: c.get("workspaceId"),
    document: "marketing", version: MARKETING_CONSENT_VERSION, granted: body.granted,
  });
  if (error) return dbError(c, error, "db_error", 500);
  return c.json({ marketing: { granted: body.granted } });
});
