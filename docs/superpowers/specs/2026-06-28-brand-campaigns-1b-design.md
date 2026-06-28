# Brand Self-Serve Campaigns (G1 Slice 1b) — Design Spec

**Goal:** Give a brand a self-serve surface to **author and close** their own time-boxed campaigns at `/brand/campaigns`, mirroring the brand mission-authoring portal — reusing the engines, validation, and brand RLS already shipped in Slice 1. **Cash settlement stays operator-only.**

**Branch:** `feat/brand-campaigns-1b`, stacked on `feat/campaigns-g1` (it requires `0025`'s brand RLS policies). Auto-retargets to `main` when [#50](https://github.com/YNWAforever/Remix-Adfocate/pull/50) merges. **No migration, no new env.**

**Source slices reused:** Slice 1 (`0025_campaigns.sql` engines + `campaignAuthoring`/`campaignLeaderboard` libs + the operator console) and the brand portal Slice 1 pattern (`server/routes/brand.ts`, `requireBrand()` middleware, `makeUserClient(jwt)` RLS reads/writes, `0023` brand RLS idiom).

---

## §1. Scope & non-goals

**In scope (a brand can):**
- List / view their own campaigns (RLS-scoped to their workspace).
- Create a draft, edit it (honoring the edit-lock matrix), publish (draft → active), and close (active → closed).
- Attach / detach missions (from their own workspace) to a draft/active campaign.
- View the live leaderboard for their own campaign.

**Out of scope (explicit non-goals):**
- **Settle / cash payout** — operator-only via the existing `/admin` console. (Reason: the brand budget-funding UI — brand-portal Slice 3 — is not on this branch, so a brand cannot top up the HK$ budget that settle debits.)
- Brand budget funding/management UI (Slice 3).
- Brand analytics dashboard (Slice 4).
- Brand-facing notifications.
- Any migration or schema change.

**Cross-surface contract:** A brand authors + closes; the **operator settles** the brand's closed campaign from `/admin/campaigns` (the operator console already lists all workspaces' campaigns and can settle any closed one). This is the intended division of labor for Slice 1b.

## §2. Auth & isolation model

Identical to brand missions. The brand router mounts under `requireBrand()`, which sets `c.var.brand = { email, workspaceId, role }` from the magic-link session (never from the request). Two access paths:

- **`makeUserClient(bearer(c))`** (user-JWT client) for all reads and direct writes — Postgres **RLS** (`0025` brand policies on `campaigns`, `campaign_missions`; brand SELECT on `campaign_participants`) enforces workspace isolation. `workspace_id` on inserts is always taken from `c.var.brand.workspaceId`, never the body; the RLS `with check` is the backstop. A read for another workspace's row simply returns nothing → **404**.
- **`serviceClient()`** ONLY for the two SECURITY-DEFINER operations a brand needs (`close_campaign`, `rank_campaign`), each preceded by an **ownership gate**.

**Ownership gate — `brandOwnsCampaign(uc, id)`:** a helper that does an RLS read of the campaign via `makeUserClient`. If it returns null (RLS hid it because it's another workspace's, or it doesn't exist) the route returns **404** before any privileged call. If it returns the row, ownership is proven and the route proceeds with `serviceClient`. This mirrors the established brand.ts pattern ("the mission is already confirmed to belong to this brand by the RLS read above").

## §3. Server — `server/routes/brandCampaigns.ts`

A new `Hono<BrandEnv>` router (`export const brandCampaignRoutes`), mounted in `server/routes/brand.ts` under the guarded router: `guarded.route("/campaigns", brandCampaignRoutes)`. Column sets mirror the operator route's `PUBLIC`/`CAMPAIGN` cols (no `created_by`/audit internals exposed beyond what the brand needs). Endpoints:

| Method & path | Client | Notes |
|---|---|---|
| `GET /campaigns` | `makeUserClient` | RLS-scoped list; optional `?status=` filter. |
| `GET /campaigns/:id` | `makeUserClient` | campaign + attached missions (`is removed_at null`) + participant count (brand SELECT RLS on `campaign_participants`). 404 if not theirs. |
| `POST /campaigns` | `makeUserClient` insert | `validateCampaign(body, "draft")`; `workspace_id` forced from `c.var.brand`; `status:"draft"`. 23505 → 422 (slug dup). |
| `PATCH /campaigns/:id` | `makeUserClient` | `validateEdit(existing, patch, hasEngagement)`; `hasEngagement` = participant count > 0. 404 if not theirs. |
| `POST /campaigns/:id/publish` | `makeUserClient` update | guard `status==='draft'` (else 409); `validateCampaign(existing,"publish")`; set `status:'active', published_at`. |
| `POST /campaigns/:id/missions` | `makeUserClient` insert | body `{mission_id}`; `canAttachMission` pre-check; the composite FK guarantees the mission ∈ brand workspace; 23505 → 409 (one-active-per-mission). Reject if campaign `settled`/`closed`. |
| `DELETE /campaigns/:id/missions/:missionId` | `makeUserClient` update | set `removed_at`; reject if `closed`/`settled`. |
| `POST /campaigns/:id/close` | gate → `serviceClient` | `brandOwnsCampaign` (404) → `close_campaign(id)` RPC; map `wrong_state`→409. |
| `GET /campaigns/:id/leaderboard` | gate → `serviceClient` | `brandOwnsCampaign` (404) → `rank_campaign(id)` RPC → `shapeLeaderboard` (decorate with `creators.display_name/avatar_url/level`). |

**Explicitly absent:** no settle endpoint, no edit/attach after close, no budget endpoints. Error-code conventions match the operator route (`validation`/`conflict`/`not_found`/`db_error`).

## §4. Reused libs / validation

No new pure logic. The route imports from the existing Slice 1 libs:
- `campaignAuthoring` — `validateCampaign`, `validateEdit`, `canAttachMission`, `CAMPAIGN_EDITABLE_COLS`, types.
- `campaignLeaderboard` — `shapeLeaderboard`.

Client validation of prize tiers reuses the same inline rules as the operator form (the server re-validates via `validateCampaign`/`validateEdit`; settle-time tier re-validation is operator-only and unchanged).

## §5. Client — `src/routes/brand.campaigns.*`

Mirror `src/routes/brand.missions.*` (auth via the brand context, `brandFetch`-based fetchers in `src/lib/brand.ts`, React Query). New files:
- `brand.campaigns.index.tsx` — list with status chips, "New" link, per-row **Publish/Close** actions (no Settle). Invalidate the list query on mutation.
- `brand.campaigns.new.tsx` — draft form (slug/title/description/window/goal/bonus points+xp + `CampaignPrizeTiers` editor) → create → navigate to manage.
- `brand.campaigns.$id.tsx` — edit form honoring the lock matrix (disable config once `status!=='draft'`), mission attach/detach picker, Publish/Close actions, a **read-only leaderboard** view, and a "Settlement is handled by your Fimmick operator" hint on a closed campaign.
- Brand client fetchers/keys/types — add to **`src/lib/brand.ts`** (mirror the existing `fetchBrandMissions`/`brandFetch`/`brandKeys` patterns).
- A brand nav entry (campaigns) in **`src/components/brand/BrandNav.tsx`**.
- Route-stub test `src/routes/-brand.campaigns.test.tsx` — mirror the operator campaign stub `src/routes/-admin.campaigns.test.tsx` (adapt the mocked contexts/lib to the brand equivalents): list renders a row; Publish calls the publish fetcher.

i18n: add `app.brand.*` campaign keys (en + zh, identical key sets — parity guard). Reuse `app.campaigns.*` keys where they already exist; add brand-specific labels (e.g. settle-is-operator hint) as needed.

## §6. Tests

**Integration — `server/test/brand-campaigns.test.ts`** (uses `makeBrand`, `makeCreator`, `makeMission`, `cleanup`; runs with `RUN_INTEGRATION=1`):
- A brand creates a draft → publishes → it appears in its own list.
- A brand can attach a mission from its own workspace; attaching one already active in another campaign → 409.
- A brand can close its own active campaign (200, status→closed); closing a foreign workspace's campaign → **404** (ownership gate).
- A brand **cannot read or edit another workspace's** campaign (RLS): a second brand's `GET /campaigns/:id`/`PATCH` returns 404; its list never includes the first brand's campaign.
- A brand's leaderboard read for its own campaign returns ranked rows; for a foreign campaign → 404.
- There is **no settle endpoint** on the brand router (a `POST /brand/campaigns/:id/settle` 404s as an unknown route).

Add the file to the `test:integration` list in `package.json`. Reuse the global `cleanup()` (already deletes test campaigns/workspaces).

**Route-stub** — `src/routes/-brand.campaigns.test.tsx` (mirror the brand mission stub).

## §7. Risks & edge cases

- **One-active-mission across surfaces:** the global partial-unique index means a brand attaching a mission already in an operator's (or another brand's) active campaign → 23505 → 409. Surfaced as a friendly conflict message. Correct by design.
- **Close via RLS vs RPC:** brands have RLS UPDATE on `campaigns`, so a raw status flip would bypass `close_campaign`'s validation. The route deliberately routes close through the RPC (ownership-gated) to keep the state-machine validation authoritative; the brand edit `PATCH` must NOT allow setting `status`/`closed_at`/`settled_at` (only `CAMPAIGN_EDITABLE_COLS` are copied).
- **Operator/brand co-visibility:** the operator console lists all campaigns (optionally workspace-filtered) and can settle a brand-closed campaign — the intended hand-off. No change needed operator-side.
- **Stacked branch:** this branch carries Slice 1's commits; the 1b PR's diff vs `main` will include them until #50 merges (then it auto-narrows). Reviewers should review only the 1b commits.
