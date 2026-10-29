# 00 — Actors, system map and baseline

Review date: 2026-10-29 · Commit reviewed: `15f8ed1` (main after PR #68) · Reviewer: Claude Code (read-only review)

Anything marked **Assumption** is inferred, not proven by code.

## 1. Product in one paragraph

Adfocate ("KOCMAX") is a Hong Kong–focused, bilingual (zh-HK / en) platform where
**KOCs / micro-creators** join or apply to brand **missions**, produce social content,
submit evidence (legacy flow: post URLs; "active workspace" flow: drafts → review →
revision → publish → publication proof), and earn **points, XP/levels and HKD cash
credits**. Points can be redeemed for gift codes. Cash credits accumulate in an
"earnings" balance, but **there is no payout or withdrawal flow**: finance settles
outside the product. Staff (Fimmick) operate review queues, authoring, CRM and reward
hand-offs. Brands have a small self-serve portal for authoring missions.

## 2. Stack

| Concern | What is used | Evidence |
|---|---|---|
| Frontend | React 19 SPA, TanStack Router (file routes) and Query, Tailwind 4, Vite 7 | `package.json`, `src/routes/`, `vite.config.ts` |
| API | Hono 4, one Vercel Node function mounted at `/api` | `api/index.ts`, `server/app.ts:27-67` |
| Auth | Supabase Auth: email+password, magic link, Google (flag), WhatsApp/SMS OTP (flag) | `src/routes/_app.login.tsx`, `src/lib/features.ts`, `.env.example` |
| DB | Supabase Postgres, 78 migrations, RLS plus SECURITY DEFINER RPCs | `supabase/migrations/` |
| Storage | Supabase Storage (avatars, profile media, content media, private mission assets and proof) | e.g. `0015_*`, `0021_*`, active-mission migrations |
| Payments | **None.** Cash is a ledger (`earnings_balances` / `earnings_transactions`). Gift codes are pre-loaded. | `server/routes/wallet.ts`, `0006_*` |
| Background jobs | Vercel Cron: `/api/cron/daily` (00:00 UTC), `/api/cron/social-refresh` (Mon 03:00 UTC) | `vercel.json`, `server/routes/cron.ts` |
| Third-party APIs | Vercel AI Gateway (LLM plus embeddings), RapidAPI social scrapers (Instagram/Threads) | `.env.example`, `server/lib/llm.ts`, `server/lib/social/rapidApi.ts` |
| Email | Supabase Auth emails only. No transactional or notification email. | `docs/deployment-config-runbook.md` item 8 |
| Deploy | Vercel project `adfocate-2` with SPA rewrites; Supabase project in the cloud | `vercel.json`, runbook |
| CI | GitHub Actions: build/test and integration (integration cannot run on Linux; see F-005) | `.github/workflows/ci.yml` |

## 3. Actors

### Creator (KOC), the primary actor
Signs up through `/login`, gets bootstrapped into one workspace (`POST /api/me/bootstrap`,
`server/routes/me.ts:45`) and completes five onboarding steps. They then discover,
apply to or join missions, submit content and evidence, receive review outcomes, and
earn points/XP/cash. They can redeem points for gifts and share a public "passport".
- **Auth:** Supabase JWT plus `X-Workspace-Slug`. `workspaceAuth` requires a `creators` row in that workspace (`server/middleware/workspace.ts:5-33`).
- **Data access:** a user-JWT client (RLS) for most reads. A service-role client for some writes, always keyed to the JWT `uid`.
- **Assumption:** "Creator" here covers anyone producing or remixing content for campaigns. Nothing in the product is literally a "remix" of an existing ad. The repo name is historical.

### Operator (Fimmick staff), the second primary actor
Uses `/admin/*` and `/operator/*` behind `StaffAuthGate` (Google OAuth or Supabase session).
- **Identity:** a `staff_users` row with `active = true` (`server/lib/staffAuth.ts:68-102`).
- **Workspace scope:** exactly one active `brand_users` row (`server/lib/staffWorkspace.ts:12-29`).
- **Workspace roles** (`server/lib/staffCapabilities.ts:7-15`):

| Role | Capabilities |
|---|---|
| `workspace_admin` | all |
| `operator` | everything except `mission.manage`, `reward.settings`, `access.manage` |
| `reviewer` | `creator.read`, `submission.review`, `proof.review` |
| `finance_viewer` | `reward.read` |

- **Platform role:** `content_editor` (`content.manage`) for the CMS and Academy (`20261023124149_staff_access_capabilities.sql:16-18`).

We treat these sub-personas of Operator separately in the journeys:
- **Reviewer / moderator:** applications, submissions, active-mission review, publication proof.
- **Ops / workspace admin:** mission and campaign authoring, CRM, roles, settings.
- **Finance viewer:** the reward hand-off queue (read-only, "finance review pending").
- **Content editor:** news and Academy CMS (cross-workspace).

### Brand / advertiser (secondary)
Invited by staff (`POST /api/admin/brand-invites`). Logs in by magic link at `/brand/login` and accepts the invite (`POST /api/brand/accept`). Can create, edit, publish and close **their own workspace's missions** and read brand resources (`server/routes/brand.ts`). Cannot see applicants, submissions, spend or reports.
- **Assumption:** brands do not fund budgets in-product. `credit_workspace_budget` has no API caller.

### Public viewer (secondary)
Unauthenticated visitors to marketing pages (`_site.*`) and to shared creator passports (`/passport/:token` → `GET /api/public/passports/:token`).

### System actors
- **Vercel Cron** (`CRON_SECRET` bearer): publishes scheduled content, snapshots leaderboards, closes due campaigns, refreshes social metrics.
- **LLM gateway:** mission-match rationale, hook generator, assistant chat (a knowledge base backed by embeddings).
- **Break-glass `ADMIN_SECRET`:** now permits nothing. A valid secret returns `401 staff_session_required` (`server/routes/admin.ts:33-36`). The docs still describe it as active.

### Important structural facts
- **Staff membership reuses `brand_users`.** An operator's workspace scope is a `brand_users` row, so every staff member is also, technically, a brand user of that workspace. They pass brand RLS policies on `missions` and `campaigns` (`0023_brand_access.sql:36-49`). **Assumption:** this is intentional for a single-workspace pilot.
- **Single workspace per deploy:** `VITE_DEFAULT_WORKSPACE` and `BOOTSTRAP_WORKSPACE_SLUGS` (`.env.example`). The R1 pilot is explicitly single-workspace (`docs/verification/2026-10-24-adfocate-pilot-readiness.md`).

## 4. System map

### 4.1 Pages (`src/routes/`)

| Area | Routes |
|---|---|
| Marketing (`_site`) | `/`, `/creators`, `/brands`, `/earn`, `/packages`, `/playbooks`, `/stories`, `/contact` (does not send), `/legal/privacy`, `/legal/terms` |
| Auth | `/login`, `/auth/callback`, `/auth/reset-password`, `/brand/login`, `/brand/auth/callback` |
| Creator app (`_app`, guarded) | `/onboarding`, `/home`, `/mission`, `/mission/:slug`, `/match`, `/my`, `/my/:submissionId` (active workspace), `/campaigns`, `/campaigns/:slug`, `/wallet`, `/redemption`, `/redemption/history`, `/notifications`, `/profile`, `/passport`, `/guide/*`, `/news/*`, `/explore`, `/more` |
| Public | `/passport/:token` |
| Operator (`admin`, `operator`) | `/admin` → `/admin/insights`, `/admin/radar`, `/admin/engaged`, `/admin/applications`, `/admin/submissions`, `/admin/active-missions[/:workflowId]`, `/admin/reward-handoffs`, `/admin/creators`, `/operator/creators/:id`, `/operator/missions/:id`, `/admin/missions[/new\|/:id]`, `/admin/campaigns[/new\|/:id]`, `/admin/content[/:id]`, `/admin/academy[/:id]` |
| Brand | `/brand`, `/brand/missions[/new\|/:id]`, `/brand/resources[/:slug]` |

### 4.2 API groups (`server/routes/`, all under `/api`)

| Group | Auth | Notes |
|---|---|---|
| `/me/bootstrap` | any Supabase JWT | Creates the creator plus balance rows (service role) |
| `/me`, `/onboarding`, `/wallet`, `/missions`, `/my-missions`, `/campaigns`, `/match`, `/notifications`, `/copilot`, `/assistant`, `/redemption`, `/social`, `/workspace`, `/content`, `/academy` | creator JWT + workspace | `workspaceAuth` |
| `/admin/*` | staff JWT + capability + workspace | Deny-by-default route table, `server/lib/staffCapabilities.ts:58-101` |
| `/brand/*` | brand JWT + active `brand_users` | RLS client |
| `/public/passports/:token` | none | Token is sha256-hashed |
| `/cron/*` | `CRON_SECRET` bearer | Fails closed if unset |

### 4.3 Main data domains
The detailed table inventory and RLS review are in `02-findings.md` (Data and Security rows).

| Domain | Tables / objects |
|---|---|
| Identity / tenancy | `workspaces`, `creators`, `staff_users`, `brand_users`, `brand_invites`, `staff_workspace_roles`, `staff_platform_roles`, `staff_access_audit` |
| Missions (legacy) | `missions`, `mission_submissions` (anchor row per creator × mission) |
| Active workspace | workflows, work items, draft versions, assets, reviews, `mission_workflow_events`, publication proof attempts and reviews, `mission_reward_contracts`, `mission_pending_rewards` (hand-off) |
| Value | `point_balances` / transactions, `earnings_balances` / `earnings_transactions`, XP/levels on `creators`, `workspace_budgets` / ledger, `gifts`, `redemption_codes`, redemption intents |
| Engagement | `notifications`, campaigns plus leaderboards, academy content and progress, `content` (news), assistant requests/messages/KB |
| Social / trust | `creator_social_accounts`, snapshots, public passports, profile media |
| Ops / audit | `operator_audit_events`, `mission_workflow_events`, CRM notes, shortlist, staff access audit |

### 4.4 State machines

**Legacy mission submission** (`mission_submissions.status`):

```
           apply ─► applied ──accept──► joined ◄──request-correction── (submitted|under_review)
                       └──decline──► declined
  join (open) ─────────────────────► joined ──submit──► submitted ─► under_review
                                                   submitted|under_review ──approve──► approved   (points + XP + cash + budget debit, one tx)
                                                   submitted|under_review ──reject───► rejected   (terminal; no resubmit)
                                     (deadline) ──► expired
```

**Active workspace** (missions with `creator_workflow_mode = active_workspace`):

```
joined ─► workflow created ─► draft (autosave, revisioned) ─► submitted ─► in_review
in_review ─► revision_requested ─► (creator edits) ─► submitted …   (revision limit, SLA deadlines)
in_review ─► approved_to_publish ─► [fulfilment shipped → received] ─► publication proof submitted
proof ─► corrections_requested ─► resubmitted … ─► verified ─► completion approved
completion ─► reward hand-off: pending (finance review) ─► cancelled | (settled off-platform)
```

**Application decision:** `applied → accepted (joined) | declined`, idempotent with request id; first decision wins.

**Campaign:** `draft → active → closed → settled` (cron closes due campaigns; settle is staff action).

**Content/academy:** `draft → scheduled → published` (cron publishes scheduled).

**Redemption:** `intent (client_request_id) → redeemed (code issued, points debited)`; legacy path without id is non-idempotent.

## 5. Baseline (Phase 0, local, 2026-10-29)

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ 0 errors, 4 warnings: `react-hooks/exhaustive-deps` in `PublicationProofReview.tsx`, `queries/activeMission.ts`, `_app.onboarding.tsx` |
| Typecheck | `npm run type-check` | ✅ exit 0 |
| Build | `npm run build` | ✅ exit 0. Largest chunks: `index` 440 kB, `vendor-supabase` 208 kB, `vendor-react` 193 kB, `Markdown` 162 kB (raw) |
| Unit / component | `npm test` (vitest) | ✅ 261 files passed, 44 skipped; **2402 tests passed, 363 skipped** (178 s) |
| Local DB | `supabase start` (Docker) | ✅ all 78 migrations and seed applied. Optional services excluded because of a sandbox rlimit. |
| Integration | `npm run test:integration` | ❌ refused before running: `integration target identity is required` (`scripts/run-integration-tests.mjs:86-87`) |
| Integration (direct vitest, same 40 files) | `RUN_INTEGRATION=1 vitest run <files>` | ⚠️ 187 passed, **102 failed** (all at the same identity guard in `server/test/helpers.ts` → `assertIntegrationEnvironment`), 152 skipped |
| E2E | Playwright configs (7) | Not yet run (Phase 3) |

Implication: the business-critical DB/RLS integration suite is **not runnable** in CI on
Linux or in this environment without the repo's owner-authorised target identity. CI was
explicitly skipped for PR #68 (`.github/workflows/ci.yml` integration `if:`;
`docs/verification/2026-10-28-pr-68-ci.md`).
