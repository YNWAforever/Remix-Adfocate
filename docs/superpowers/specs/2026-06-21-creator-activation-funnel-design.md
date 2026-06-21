# Creator Activation Funnel — Umbrella Design (North Star)

**Date:** 2026-06-21
**Status:** Umbrella / decomposition doc. Each slice below gets its own spec → plan → implementation cycle.
**Scope of this doc:** The creator-facing activation journey — signup, login, onboarding, **verification**, and the **guideline/playbook walkthrough** — unified into one coherent funnel inside the live `adfocate-2` app.

This is a north-star doc: it locks the shared model and decisions, then decomposes the work into independently-shippable slices. It is **not** directly implementable — the per-slice specs are.

---

## 1. Goal

Today the creator journey is fragmented: login/signup and a thin onboarding wizard exist in-app, the marketing `/creators` page *promises* a richer journey (sign up → pick mission → build Passport → unlock → Adfoplace → finance-ready), and the two use **different level names**. Verification and an in-app guideline/playbook experience don't exist at all.

**Unify these into one progression that the creator (and the UI) can always see — the funnel *is* the level ladder.** Signup, onboarding, verification, and education stop being separate features and become *stages of one climb*.

Build on the live `adfocate-2` codebase (real Supabase backend, TanStack Router SPA, Hono `/api`). Full bilingual (en / zh-HK) per the One-Unification direction.

---

## 2. The funnel spine

The activation funnel maps 1:1 onto the level ladder. The three requested capabilities slot in as labelled:

| Stage | Level | What happens here | Gate to advance |
|---|---|---|---|
| **Enter** | pre-L0 | Marketing `/creators` → "Start" → passwordless signup (phone OTP / email magic-link / Google). `finishAuth` bootstraps the creator. | account created |
| **Discover** | **L0 Shopper** 🛍️ | **First-run walkthrough** (platform guidelines + playbook primer) → onboarding wizard (categories, add *unverified* handles). Browse missions & rewards. | finish onboarding + complete first mission |
| **Start creating** | **L1 KOC Starter** 🌱 | Real missions; earn points/XP. L1 Guide-hub sections unlock. | XP ≥ 2000 **+ pass bio-code verification** |
| **Prove reliability** | **L2 Trusted KOC** 💬 | **Verification gate** (bio-code ownership). Unlocks L2-gated (`required_level='L2'`) missions + verified badge. | sustained activity |
| **Go pro** | **L3 Nano Creator** 📱 | Adfoplace / "use our product," higher-value briefs. | … (existing engine) |
| L4–L6 | Micro-Influencer 🚀 → … | existing XP engine continues unchanged | |

"The user decides" = the ladder is **always visible** (home + a progress header), so creators self-locate and choose how far to climb. There is **no forced fork** at signup — everyone starts at L0 and the level reflects activity.

---

## 3. Locked decisions

1. **Canonical ladder = the marketing names.** One source of truth (`src/lib/levels.ts`): `L0 Shopper`, `L1 KOC Starter`, `L2 Trusted KOC`, `L3 Nano Creator`, `L4 Micro-Influencer`, `L5 Influencer`, `L6 Creator Entrepreneur` (the full marketing set from `src/data/mockData.ts`). The engine's current labels (Newcomer/Explorer/Creator/Amplifier/Pro Creator/Elite) are renamed. **This is a data-model reconciliation, not just read-wiring:** marketing `creatorLevels` (`mockData.ts`) is a separate, richer shape (goal / unlocks / incomeExample / emoji, with its own divergent XP values 0/100/500/1200/3000/8000/20000) — Slice 1 decides whether `LevelDef` gains marketing fields or `creatorLevels` derives from `LEVELS`. Engine XP thresholds (0/500/2000/6000/15000/40000/100000) are kept unless the slice spec decides to change them.
2. **Verification = bio-code social-ownership check.** Creator drops a one-time code in their social bio; the backend scans the profile (reusing the existing RapidAPI scan) and, if the code is present in the parsed `bio`, flips ownership to verified. **No** OAuth social login, **no** identity/HK-ID check, **no** mandatory operator manual review (manual review may be a later fallback).
3. **Verification is a HARD gate L1 → L2 (enforced at the app layer).** L0–L1 stay fully open and unverified. To be treated as **L2 Trusted KOC** a creator needs **XP ≥ 2000 AND ≥ 1 verified handle**. The leveling DB trigger stays **XP-only** (unchanged); the verification requirement is a derived app-layer check (an `is_trusted` / L2-eligibility flag), so the engine's raw `level` column and the funnel's "Trusted" status can differ until the creator verifies. "Reliability" in the funnel table is **narrative** (it maps loosely to the existing Reliability passport score) — it is *not* a separately enforced gate; Slice 1 gates only on (XP ≥ 2000 AND verified). **L2-only missions are gated via the existing `required_level` column** (`required_level='L2'`) — no new mission attribute (see §6).
4. **Walkthrough = first-run guided tour + persistent Guide hub.** A short first-run walkthrough (platform rules + playbook primer) woven into onboarding, handing off into a persistent, browsable in-app Guide/Academy hub whose deeper sections unlock by level.

---

## 4. Current-state grounding

**Already built (live):**
- **Signup/login** — `src/routes/_app.login.tsx`: passwordless. WhatsApp/SMS OTP is feature-flagged (`WHATSAPP_LOGIN`, currently off → email magic-link is primary); Google OAuth flagged (`GOOGLE_LOGIN`). Login *is* signup — `src/lib/auth-flow.ts` `finishAuth` bootstraps the creator on first auth, then routes to `/onboarding` or `/home`.
- **Onboarding** — `src/routes/_app.onboarding.tsx`: a resumable 5-step wizard (categories → social handles → recommended missions → claim welcome bonus + referral code), with a server-persisted step pointer (`server/routes/onboarding.ts`, `creators.onboarding_step` / `onboarding_completed`).
- **Leveling engine** — `src/lib/levels.ts`: XP→level via the Slice 6A DB trigger (`0008_leveling.sql`). 7 levels L0–L6 with XP thresholds (0 / 500 / 2000 / 6000 / 15000 / 40000 / 100000). **Labels currently differ from the marketing set** — this is the mismatch Slice 1 fixes. **Rename propagation is uneven:** `/profile` (`LevelChip`) and `/passport` (`LevelProgress`, `PublicPassportView`) render `.label` dynamically and pick up a rename for free; but the **home header chip** (`_app.home.tsx:37`) renders the raw level **ID + emoji** (`L0`), not the label — surfacing the marketing label there is a small *extra* UI task. Marketing `creatorLevels` (`mockData.ts`) is a standalone array, not derived from `levels.ts`.
- **Mission level-gating** — the `missions` table already has `required_level text default 'L0'` (`0001_init.sql`) and `src/lib/missionMeta.ts` enforces a `levelIndex` check, so gating L2-only missions needs **no schema change** (set `required_level='L2'`). There is **no** purpose-built "paid"/"brand" mission flag (`access_type` spans only `open|application`; brand work is a `mission_type` value `brand_ambassador`; paid-ness is implied by `cash_reward`/`cpm_rate`).
- **Social subsystem** — migration `0012_trust_profile_bundle.sql` table `creator_social_accounts` already has **`owner_verified boolean default false`** and a **`bio text`** column; `server/lib/social/` (`rapidApi.ts`, `service.ts`, `repo.ts`) already parses the profile **`biography`** into `SocialScanResult.bio` (+ `hasBio`). `SocialTrustPanel.tsx` adds handles + triggers a scan but always shows "Ownership not verified" because `owner_verified` is never set true. RapidAPI is **dormant** (graceful 503 until `RAPIDAPI_*` env is set).
- **Guideline content** — `content/help/*.zh-HK.md` (8 docs: account, leveling, missions, points, profile, redemption, submission, wallet). **No route consumes them.** Playbook content is mock data on the marketing `/playbooks` + `/creators` pages only.

**Gaps:** ownership is never verified (no issue-code / compare-and-flip / L2 gate); guidelines & playbook are not surfaced in-app; no first-run walkthrough; level names are inconsistent.

**Key implication:** bio-code verification is *mostly scaffolded already* — the column (`owner_verified`), the storage (`bio`), and the scan-and-parse path all exist. Slice 1 mainly adds code issuance/comparison + the gate + UI wiring, not a new subsystem.

---

## 5. Decomposition (2 slices)

### Slice 1 — Canonical Ladder + Verification gate
*Combines the level rename and the verification gate, because the L1→L2 gate is the whole point of the ladder.*
- **Ladder:** one canonical source of truth in `src/lib/levels.ts` (marketing labels + emoji + i18n keys). Reconcile marketing `creatorLevels` (`mockData.ts`, richer shape) — derive it from `LEVELS` or fold its fields into `LevelDef`. Update the **home header chip** (`_app.home.tsx`) to show the label (today it shows the raw ID); `/profile` + `/passport` pick up the rename for free. *Frontend + i18n; no migration.*
- **Verification:** migration adds `verification_code` + `code_expires_at` + `verified_at` to `creator_social_accounts`; backend endpoints to **issue** a one-time code and **verify** (reuse the existing scan, check `code ⊂ bio`, flip `owner_verified`, stamp `verified_at`, with code expiry + anti-reuse); UI in onboarding + `SocialTrustPanel` ("put this code in your bio → Verify").
- **L2 gate:** derived app-layer `is_trusted` = (XP ≥ 2000 AND ≥ 1 verified handle); gate L2-only missions via their existing `required_level='L2'` (no new mission attribute). Locked-mission copy points to verification.
- *Migration (social columns only) + backend + frontend + i18n.* The meatiest slice.

### Slice 2 — Guide hub + first-run walkthrough
- Render `content/help/*.md` guidelines + the playbook content into a **persistent in-app Guide/Academy hub** (e.g. `/guide`) with **level-unlocked sections**.
- Weave a short **first-run walkthrough** (platform rules + playbook primer) into onboarding, with a "seen" flag.
- *Frontend + content (markdown renderer, bilingual structure); light backend (a `walkthrough_completed` flag or reuse onboarding flags).*

**Build order: Slice 1 → Slice 2.** Slice 1 establishes the ladder + the gate that gives the funnel meaning; Slice 2 is the education layer that explains it (and references both the levels and verification).

---

## 6. Risks & open questions (resolve in the per-slice specs)

1. **RapidAPI is dormant in prod.** Bio-code verification can only *run* once `RAPIDAPI_*` keys are set (otherwise the scan returns a 503-equivalent `provider_not_configured`). Slice 1 spec must decide: ship behind a flag / provide an operator manual-approve fallback / treat "verification unavailable" gracefully. Tests use the existing `server/lib/social/fixtures` (the Instagram fixture already carries a `biography` string, usable for bio-parse tests).
2. **L2 gate mechanics (resolved → implementation detail).** The model is fixed in §3: app-layer `is_trusted` = (XP ≥ 2000 **AND** ≥ 1 verified handle); the leveling trigger stays XP-only. The Slice 1 spec only needs to choose *where* the derived check lives — a SQL view/generated column vs. computed in `/api/me`.
3. **Paid/brand mission gating (resolved → reuse `required_level`).** No purpose-built paid/brand attribute exists. Slice 1 gates L2-only missions via the existing `required_level='L2'` column — **no mission-schema change**. A dedicated "brand"/"paid" mission taxonomy is out of scope (future work).
4. **XP threshold review.** The marketing ladder's narrative ("first missions", "prove reliability") should still line up with the engine's XP bands after the rename. (Marketing `creatorLevels` XP values diverge from the engine's; the engine's are canonical unless Slice 1 decides otherwise.)
5. **Bilingual guide content.** `content/help/*` is zh-HK only; the Guide hub (Slice 2) needs an en counterpart or a bilingual content structure.
6. **Verification anti-abuse.** Code expiry, re-use across accounts, handle uniqueness (the table already has a `(creator_id, platform, handle_normalized)` unique constraint) — specify in Slice 1.
7. **Markdown dependency (Slice 2).** No markdown renderer exists in `package.json` today — Slice 2 must add one (e.g. `react-markdown`) and sanitize output, since `content/help/*.md` would render as HTML.

---

## 7. Out of scope (this funnel effort)

Identity / HK-ID verification; OAuth social login (Meta/TikTok app review); Adfoplace, creator capital / finance-readiness products; L3+ "use our product" surface; brand-side console changes.

---

## 8. Next step

Brainstorm **Slice 1 (Canonical Ladder + Verification gate)** into its own implementable spec, then invoke `writing-plans`. Slice 2 follows after Slice 1 ships.
