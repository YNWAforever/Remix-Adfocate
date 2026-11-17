# Live connections runbook (opt-in)

Status: **code path built, default deployment unchanged.** `createLiveIntegrationRuntime()` can
run the existing Instagram Login and Google Drive protocols against live providers, but only when a
complete environment package is supplied. Without it, `/connections` keeps the D0 behaviour
(mock/disabled) and no coordinator, provider or Supabase client is constructed.

This runbook is the operational half. The product-side gates in
[D2 handoff](../d1/d2-handoff.md) and [Instagram blockers](../d1/instagram-blockers.md) still
apply: do not enable provider flags for real creators until the named gates are cleared.

## What the live package turns on

| Surface | D0 (current) | Live package |
| --- | --- | --- |
| `GET /api/me/integrations` | `{ mode: "disabled" }` | `{ mode: "live_pilot", connections }` |
| Connect | mock consent endpoint | provider login via `POST /api/me/integration-oauth/:provider/start` |
| Callback | `503 PILOT_APPROVAL_REQUIRED` | `GET /api/integration-oauth/:provider/callback` stores the encrypted code, then redirects to `/connections#ticket=…` |
| Complete | mock code | `POST /api/me/integration-oauth/:provider/complete` exchanges the code and persists the grant |
| Mock start/complete, mock picker catalogue | available in mock mode | closed with `409 OAUTH_REQUIRED` |
| Sync, resources, import, revoke, purge | mock-only by policy | real, per provider flag |

## 1. Database

The four scoped migrations are already in `supabase/migrations` and were applied to the product
database in the D1 closeout:

- `20261031120000_creator_integrations.sql`
- `20261031121000_studio_integration_evidence.sql`
- `20261031122000_integration_privacy_cleanup.sql`
- `20261031123000_integration_pilot_persistence.sql`

Verify before enabling (read-only):

```sql
select to_regclass('public.integration_connections'), to_regclass('public.integration_resources');
select proname from pg_proc where proname in ('integration_command','integration_oauth_callback','integration_oauth_lookup');
```

Both tables must exist and the three functions must be present. Tokens live only in encrypted
columns written by the service role; anon/authenticated must not have direct table access.

## 2. Keyring

Generate one 32-byte key per active rotation (base64, standard alphabet):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Pack it for `INTEGRATIONS_KEYRING` (up to 10 keys, `activeKeyId` must exist):

```json
{"activeKeyId":"2026-11","keys":{"2026-11":"<base64 32-byte key>"}}
```

Keep a durable copy in the password manager. Losing every key makes stored grants unreadable and
forces every creator to reconnect; rotating means adding a new key, switching `activeKeyId`, and
keeping the old key until no stored grant references it.

## 3. Provider applications

### Instagram (Instagram Login)

1. Meta app → add the **Instagram** product with **Instagram Login**.
2. Valid OAuth redirect URI: `https://adfocate-2.vercel.app/api/integration-oauth/instagram/callback`
   (exact string, no query/hash).
3. Permissions: `instagram_business_basic`, `instagram_business_manage_insights`.
   Non-test creators need advanced access / app review for both; test users can grant them while
   the app is in development.
4. Copy the **Instagram app ID** and **Instagram app secret**.

Open gates that still need product evidence before real creators: IG-01 revoke contract, IG-02
notice identity mapping, IG-03 canonical authorize host, IG-04 account eligibility, IG-05 smoke.
The live runtime begins authorization against `api.instagram.com/oauth/authorize` as implemented;
confirm it against the approved app in the Meta console before turning the flag on.

### Google Drive

1. Google Cloud project → enable **Google Drive API**.
2. OAuth consent screen: external, scopes `https://www.googleapis.com/auth/drive.file`, `openid`.
   `drive.file` is not read-only: disclose the write capability before consent.
3. Create an **OAuth client (Web application)** with redirect URI
   `https://adfocate-2.vercel.app/api/integration-oauth/google_drive/callback`.
4. Copy the client ID/secret and the **project number** (numeric, used for Picker and identity).
5. Live Picker needs the project number and a browser API key; the browser UI for the live Picker
   is not part of this runbook (see "Remaining work").

## 4. Vercel environment (Production)

| Variable | Value |
| --- | --- |
| `INTEGRATIONS_ENABLED` | `true` |
| `INTEGRATIONS_MODE` | `live_pilot` |
| `INTEGRATIONS_LIVE_ORIGIN` | `https://adfocate-2.vercel.app` |
| `INTEGRATIONS_KEYRING` | JSON from step 2 |
| `INSTAGRAM_CONNECTIONS_ENABLED` | `true` (only after IG gates clear) |
| `INSTAGRAM_APP_ID` | from Meta console |
| `INSTAGRAM_APP_SECRET` | from Meta console |
| `DRIVE_CONNECTIONS_ENABLED` | `true` when Drive is approved |
| `GOOGLE_OAUTH_CLIENT_ID` | from Google Cloud console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | from Google Cloud console |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | numeric project number |

Leave `INTEGRATIONS_PILOT_STAGE` unset: the D1 pilot app is a separate, closed surface and is not
used by this path. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are already required by the API.

Missing or malformed values never half-enable: `readLiveIntegrationSettings()` returns
`CONFIG_REQUIRED` with the exact missing names, `/api/me/integrations` stays `disabled`, and the
OAuth callback keeps returning `503 PILOT_APPROVAL_REQUIRED`.

## 5. Verification checklist

1. `GET /api/health` → 200 (deployment alive).
2. Signed-in `GET /api/me/integrations` → `{"mode":"live_pilot","connections":[]}`.
3. `POST /api/me/integration-oauth/instagram/start` → `authorizationUrl`, `scopes`, `sampleOnly:false`;
   open it, deny once, confirm the callback returns to `/connections` with no connection created.
4. Approve once. Confirm the connection appears with `sampleOnly:false`, the provider label and the
   granted scopes, and that no token/ciphertext appears in any response.
5. `POST /api/me/integrations/:id/sync` (Instagram) → resources with real `evidence` and
   `sampleOnly:false`; re-sync within the cooldown → `429`/rate-limit status.
6. `POST /api/me/integrations/:id/revoke` → local revoked, provider revocation result recorded; then
   `purge` deletes imported sources/derived drafts only.
7. Unset `INTEGRATIONS_ENABLED` and redeploy → `/api/me/integrations` returns `disabled` again and
   the callback returns 503. Existing rows remain (revoke/purge them while enabled, or at provider).

## 6. Rollback

Fastest: set `INTEGRATIONS_ENABLED=false` (or remove it) and redeploy. The live runtime is not
constructed, all integration routes fall back to the D0/disabled surface, and no new tokens are
written. Stored encrypted grants remain for a later re-enable; to remove data, re-enable briefly,
revoke/purge each connection, then disable again. Provider-side revocation is independent of this
deployment: revoke the app's access in the Meta/Google consoles if a creator requests it directly.

## 7. Remaining work before real creators

- Browser live flow: the Instagram connect/sync/revoke path and the generic provider connect consent
  are implemented; live Google Drive file selection (Picker) and live resource viewing are still
  mock-only and need their own UI pass.
- Instagram IG-01…IG-05 evidence (see [instagram-blockers](../d1/instagram-blockers.md)).
- Google live Picker UI and its API key; the current Picker catalogue is mock-only.
- D2 approval with named participants, live smoke, soak window and cleanup owner, as required by
  [D2 handoff](../d1/d2-handoff.md).
