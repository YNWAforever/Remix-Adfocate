# Adfocate 2.0 — Full Product Specification

**Version:** 2.0.0  
**Date:** June 2026  
**Status:** Greenfield Rewrite  
**Owner:** Willy Lai / Fimmick  

---

## Table of Contents

1. [Overview & Why Rewrite](#1-overview--why-rewrite)
2. [System Architecture](#2-system-architecture)
3. [Domain Models](#3-domain-models)
4. [API Specification](#4-api-specification)
5. [AI Agent Specifications](#5-ai-agent-specifications)
6. [KOC Onboarding System](#6-koc-onboarding-system)
7. [Creator Progression System](#7-creator-progression-system)
8. [KOCmax — Consumer PWA](#8-kocmax--consumer-pwa)
9. [Brand CRM Dashboard](#9-brand-crm-dashboard)
10. [Monetisation Architecture](#10-monetisation-architecture)
11. [Backend Service Architecture](#11-backend-service-architecture)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Infrastructure & Deployment](#13-infrastructure--deployment)
14. [Build Phases](#14-build-phases)
15. [Competitive Reference: KoLink Learnings](#15-competitive-reference-kolink-learnings)
16. [Key Technical Decisions](#16-key-technical-decisions)

---

## 1. Overview & Why Rewrite

### 1.1 What Adfocate 2.0 Is

Adfocate 2.0 is a complete ground-up rewrite of the Adfocate creator-brand matching platform. It combines:

- The existing `refreshing-adfocate` frontend design language (React 19 + TanStack Router)
- Battle-tested loyalty mechanics from `fimmick-crm-point-engine` (Laravel CRM — ported to TypeScript)
- A new AI agent layer (5 specialised agents)
- A multi-tenant brand CRM dashboard
- A CPM-based performance pay track (inspired by KoLink's model)
- A clean, scalable monetisation stack

The platform serves three audiences:

| Audience | Portal | Primary Value |
|---|---|---|
| Creators (KOC/KOL) | KOCmax PWA + Creator App | Missions → points → earnings → growth |
| Brands | Brand Dashboard | Creator discovery → campaign management → ROI tracking |
| Operators (Fimmick) | Admin Portal | Multi-tenant management, AI orchestration, revenue |

### 1.2 Current Limitations

| Problem | Current State | Target State |
|---|---|---|
| Data persistence | Static mock TS files (`kocmaxData.ts`) | PostgreSQL + Redis |
| API layer | None (SSR-only with Cloudflare Workers) | REST + WebSocket via Hono |
| AI capabilities | None | 5 AI agents (Copilot, Matching, Content Review, CRM, Finance) |
| Monetisation | None wired | 6 revenue streams |
| Multi-tenancy | Laravel subdomain DB switching | Brand workspace isolation (schema-per-tenant) |
| Creator Passport | Static demo data | Live, earned, verifiable |
| KOC Points / Redemption | Mock UI | Real engine ported from fimmick-crm |
| KOC Onboarding | No real flow | Frictionless 5-step signup with zero follower requirement |
| CPM Pay Track | Not supported | Performance pay per 1K views (inspired by KoLink) |

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     ADFOCATE 2.0 PLATFORM                        │
├────────────────────┬──────────────────────┬─────────────────────┤
│  FRONTEND (SPA)    │    API GATEWAY        │   SERVICE LAYER     │
│                    │                       │                     │
│  React 19 + Vite   │  Hono (Node 22 / TS)  │  AI Agent Mesh      │
│  TanStack Router   │  REST + WebSocket     │  Point Engine       │
│  TanStack Query v5 │  JWT + OAuth2         │  Mission Engine     │
│  Tailwind CSS v4   │  Rate Limiting        │  Matching Engine    │
│  Radix UI          │  Response Cache       │  Finance Engine     │
│                    │                       │  Background Jobs    │
│  Portals:          │  Auth Service         │  (BullMQ / Redis)   │
│  • Creator App     │  Media Service        │                     │
│  • Brand Dashboard │  Webhook Service      │                     │
│  • KOCmax PWA      │                       │                     │
│  • Admin Portal    │                       │                     │
├────────────────────┴──────────────────────┴─────────────────────┤
│                         DATA LAYER                               │
│   PostgreSQL (primary)  │  Redis  │  Cloudflare R2 (media/CDN)  │
│   Schema-per-tenant     │  Cache  │  BullMQ job queues          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React 19, Vite, TanStack Router v1, Tailwind v4 | Existing codebase; keep design system |
| API Gateway | Hono (TypeScript, Node 22) | Typed middleware; edge-deployable; excellent WS support |
| ORM | Prisma | Type-safe queries; auto-migration; schema generation |
| Database | PostgreSQL (managed) | Relational integrity for points/transactions; schema-per-tenant |
| Cache / Queue | Redis + BullMQ | Fast cache + reliable background job queue |
| AI APIs | OpenRouter → Claude claude-sonnet-4 (primary), GPT-4o (fallback) | Unified gateway; cost tracking; model switching |
| Media | Cloudflare R2 + CDN | Free egress; S3-compatible; stays in CF ecosystem |
| Payments | Stripe | Subscriptions + usage metering |
| Deployment | Zeabur (API + workers) + Cloudflare Pages (frontend) | Your existing infrastructure |

### 2.3 Multi-Tenancy Model

Each brand gets a `workspace_id`. All brand-specific data — missions, creators, point balances, redemption gifts — is partitioned by `workspace_id` at the row level in PostgreSQL. The KOCmax consumer PWA is served at `kocmax.adfocate.com/{workspace_slug}` and loaded with the brand's theme tokens.

Unlike the Laravel CRM's `SetSubdomainDatabaseConnectionAsDefault` (database-per-tenant), this uses **schema-per-tenant** in a single Postgres instance — lower ops overhead, still full isolation.

---

## 3. Domain Models

### 3.1 Core Entities

```typescript
// Workspace (Brand)
Workspace {
  id: uuid
  slug: string                   // e.g. "kocmax", "235studio"
  name: string
  plan: "starter" | "growth" | "enterprise"
  theme: JsonB                   // colors, logo, fonts for KOCmax PWA
  settings: JsonB                // feature flags, review SLA, payout config
  budget_escrow: decimal         // pre-deposited campaign budget
  created_at: timestamp
}

// Creator
Creator {
  id: uuid
  workspace_id: uuid
  email: string
  phone?: string
  display_name: string
  avatar_url?: string
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6"
  xp: integer
  categories: string[]           // e.g. ["beauty", "food", "lifestyle"]
  social_handles: JsonB          // [{platform, handle, followers, verified}]
  scores: JsonB                  // {influence, content, reliability, brandSafety}
  finance_readiness_score: integer
  onboarding_step: integer       // 1-5, tracks onboarding progress
  onboarding_completed: boolean
  status: "active" | "suspended" | "pending_review"
  referral_code: string
  referred_by?: uuid
  created_at: timestamp
}

// Mission
Mission {
  id: uuid
  workspace_id: uuid
  slug: string
  title: string
  description: text
  brief_url?: string
  category: string
  mission_type: "koc_trial" | "ugc" | "clipping" | "affiliate" | "performance_cpm" | "live_commerce" | "brand_ambassador"
  access_type: "open" | "application"   // 直接加入 vs 需要申請
  required_level: string
  points_reward: integer
  cash_reward?: decimal
  cpm_rate?: decimal             // for performance_cpm missions (e.g. HK$40 per 1K views)
  cpm_budget_pool?: decimal      // total budget available for CPM payouts
  deadline: date
  quota: integer
  filled: integer
  review_sla_hours: integer      // default 48 — auto-approve after SLA breach
  status: "draft" | "active" | "paused" | "closed"
  flow_nodes: JsonB              // from MissionFlowNode (fimmick-crm)
  trigger_config: JsonB          // from MissionTrigger
  created_at: timestamp
}

// Mission Submission
MissionSubmission {
  id: uuid
  mission_id: uuid
  creator_id: uuid
  workspace_id: uuid
  status: "joined" | "submitted" | "under_review" | "ai_approved" | "approved" | "rejected" | "expired"
  content_urls: string[]         // Reel/post URLs submitted by creator
  submission_data: JsonB
  ai_review_result: JsonB        // {pass, flags, confidence, model}
  reviewer_notes?: string
  xp_awarded: integer
  points_awarded: integer
  cash_awarded: decimal
  cpm_views_tracked: integer     // for performance_cpm: 30-day view count
  cpm_settled: boolean
  submitted_at?: timestamp
  reviewed_at?: timestamp
  review_deadline: timestamp     // submitted_at + review_sla_hours
}

// Point Balance (from fimmick MemberPointBalance)
PointBalance {
  id: uuid
  creator_id: uuid
  workspace_id: uuid
  balance: integer
  available_from: timestamp
  available_to: timestamp        // expiry date
  updated_at: timestamp
}

// Point Transaction
PointTransaction {
  id: uuid
  creator_id: uuid
  workspace_id: uuid
  type: "earn" | "redeem" | "expire" | "adjust" | "referral" | "bonus" | "multiplier"
  delta: integer
  balance_after: integer
  source_ref: string             // mission_id, redemption_id, etc.
  description: string
  created_at: timestamp
}

// Redemption Gift (from fimmick RedemptionGift)
RedemptionGift {
  id: uuid
  workspace_id: uuid
  name: string
  description: text
  category: string
  points_cost: integer
  stock_qty: integer
  stock_remaining: integer
  gift_type: "voucher" | "physical" | "digital" | "experience"
  codes: string[]                // pre-loaded redemption codes
  image_url: string
  status: "available" | "soldout" | "hidden"
  tnc_text: text
  valid_from: date
  valid_to: date
}

// Earnings Wallet
EarningsWallet {
  id: uuid
  creator_id: uuid
  pending_balance: decimal       // submitted, not yet approved
  available_balance: decimal     // approved, ready to withdraw
  total_earned: decimal
  currency: string
  payout_method: JsonB           // {type, bank_account, fps_id, ...}
}

// KOC Tracking Code (from fimmick KocTrackingCode)
TrackingCode {
  id: uuid
  creator_id: uuid
  workspace_id: uuid
  mission_id?: uuid
  code: string                   // unique UTM / short code
  clicks: integer
  conversions: integer
  revenue_attributed: decimal
  expires_at?: timestamp
}

// AI Agent Task
AgentTask {
  id: uuid
  agent_type: "copilot" | "matching" | "content_review" | "crm" | "finance"
  status: "pending" | "running" | "done" | "failed"
  input: JsonB
  output?: JsonB
  creator_id?: uuid
  workspace_id?: uuid
  triggered_by: string
  started_at?: timestamp
  completed_at?: timestamp
  model_used: string
  tokens_used: integer
  cost_usd: decimal
}
```

---

## 4. API Specification

### 4.1 Authentication

All API calls use JWT Bearer tokens. Social login (Google, Apple, LINE) issues JWTs via the Auth service. The KOCmax PWA passes `X-Workspace-Slug` header on every request; the gateway resolves it to `workspace_id`.

```
POST   /auth/login                    — email/password
POST   /auth/social/google            — Google OAuth callback
POST   /auth/social/apple             — Apple Sign-In
POST   /auth/social/line              — LINE Login
POST   /auth/refresh                  — token refresh
POST   /auth/logout
GET    /auth/me                       — current creator profile
```

### 4.2 Creator Onboarding APIs

```
POST   /onboarding/start              — create unverified account (email/phone)
POST   /onboarding/verify             — OTP verification
PUT    /onboarding/profile            — set display_name, categories, avatar
POST   /onboarding/social/connect     — connect first social handle
GET    /onboarding/status             — return current step + completion %
POST   /onboarding/complete           — finalise, award L0 welcome points
GET    /onboarding/recommended-missions — first 3 recommended open missions
```

### 4.3 Creator Portal APIs

```
# Profile & Passport
GET    /creators/me
PUT    /creators/me
GET    /creators/me/passport          — full Creator Passport
GET    /creators/me/scores            — live score breakdown
GET    /creators/me/badges

# Missions
GET    /missions                      — list (filter: category, level, type, access_type, status)
GET    /missions/:slug                — detail + brief
POST   /missions/:id/join             — join open mission
POST   /missions/:id/apply            — apply for gated mission
PUT    /missions/:id/submit           — submit content URLs + data
GET    /missions/my                   — creator's missions by status

# Points & Redemption
GET    /wallet/points                 — balance + expiry countdown
GET    /wallet/points/history         — paginated transaction log
GET    /redemption/gifts              — list (filter: category, points_range, status)
GET    /redemption/gifts/:id
POST   /redemption/redeem             — redeem gift, deduct points

# Earnings
GET    /wallet/earnings               — cash balance + pending
POST   /wallet/withdraw               — trigger payout request
GET    /wallet/earnings/history
GET    /wallet/earnings/simulate      — earnings calculator (views → projected income)

# Affiliate / Tracking
POST   /tracking/codes                — generate tracking code for mission
GET    /tracking/codes                — list creator's active codes
GET    /tracking/codes/:code/stats

# Finance Readiness
GET    /finance/score                 — current score + component breakdown
GET    /finance/score/history         — weekly score history
GET    /finance/report                — AI-generated personalised improvement plan

# Copilot AI
POST   /copilot/hook-generator        — generate content hooks from brief
POST   /copilot/caption-writer        — write captions with hashtag sets
POST   /copilot/mission-match         — suggest best-fit missions ranked by fit score
POST   /copilot/pricing-advisor       — suggest rate card per content type
POST   /copilot/compliance-check      — instant check: content URL vs. brief
POST   /copilot/finance-readiness     — explain score + action plan
POST   /copilot/brief-explainer       — plain-language summary of complex brand brief
```

### 4.4 Brand Dashboard APIs

```
# Workspace
GET    /brand/workspace
PUT    /brand/workspace/theme         — update KOCmax PWA theme
POST   /brand/workspace/deposit       — escrow budget top-up

# Mission Management
GET    /brand/missions
POST   /brand/missions
PUT    /brand/missions/:id
DELETE /brand/missions/:id
GET    /brand/missions/:id/submissions
PUT    /brand/missions/:id/submissions/:subId   — approve/reject + notes

# Creator Discovery (CRM)
GET    /brand/creators                — search + filter (level, category, score, location)
GET    /brand/creators/:id            — full passport view
POST   /brand/creators/:id/invite     — invite to mission
GET    /brand/creators/:id/history    — relationship history

# CRM Segments
GET    /brand/segments
POST   /brand/segments
POST   /brand/segments/:id/bulk-tag

# Redemption Catalogue
GET    /brand/gifts
POST   /brand/gifts
PUT    /brand/gifts/:id
POST   /brand/gifts/:id/add-codes     — upload redemption code batch CSV
GET    /brand/gifts/:id/codes         — list code pool status

# Point Rules
GET    /brand/point-rules
PUT    /brand/point-rules
GET    /brand/multiplier-campaigns
POST   /brand/multiplier-campaigns

# Analytics
GET    /brand/analytics/overview
GET    /brand/analytics/missions/:id
GET    /brand/analytics/creators
GET    /brand/analytics/points        — issuance vs. redemption funnel
GET    /brand/analytics/cpm           — CPM mission view tracking summary

# AI CRM Agent
POST   /brand/ai/segment-suggest
POST   /brand/ai/brief-writer
POST   /brand/ai/performance-summary
```

### 4.5 Webhooks

```
POST   /webhooks/line
POST   /webhooks/whatsapp
POST   /webhooks/stripe
POST   /webhooks/social/:platform     — view count updates for CPM tracking
```

---

## 5. AI Agent Specifications

### 5.1 Creator Copilot Agent

**Purpose:** Real-time AI tools triggered in-context during the creator's mission journey.

**Key principle (KoLink insight):** Copilot activates *proactively* — when a creator joins a mission, Copilot automatically offers hook ideas without being asked. The entry point "今日整乜好？" on the KOCmax home runs Mission Matcher + Hook Generator in a single flow.

| Tool | Trigger | Input | Output |
|---|---|---|---|
| Hook Generator | On mission join | mission brief + creator category + platform | 5 hooks ranked by engagement potential |
| Caption Writer | On submission page | product info + tone + platform + word limit | 3 caption variants + hashtag sets |
| Mission Matcher | Home tab quick action | creator passport scores + open missions | Ranked mission list with fit-score rationale |
| Pricing Advisor | Profile / earnings tab | creator level + past earnings + brand category | Rate card per content type |
| Compliance Check | On URL paste (submission) | content URL + mission brief | Instant pass/flag with specific fix notes |
| Brief Explainer | Mission detail page | raw brand brief | Plain-language Chinese summary |
| Finance Advisor | Finance tab | score component breakdown + 90d activity | Personalised 4-week action plan |

**Model:** Claude claude-sonnet-4 (primary) → GPT-4o (fallback)  
**Rate limits:** 20 calls/day (Starter), 100/day (Growth), Unlimited (Enterprise)  
**UX:** Slide-in `<AICopilotPanel />` component accessible from all mission pages

### 5.2 Mission Matching Agent

**Purpose:** Auto-pair creators to new missions and generate invite notifications.

**Workflow:**
1. Brand posts mission → `mission.created` event fires to BullMQ queue
2. Agent queries eligible creators filtered by `required_level` + `category`
3. Scores each creator (0–100 fit_score):
   - Category overlap: 40%
   - Past performance in same brand category: 30%
   - Brand Safety score: 20%
   - Reliability score: 10%
4. Writes ranked matches to `mission_matches` table
5. Pushes invites to top-N creators via email + LINE/WhatsApp

**Model:** GPT-4o mini (cost-optimised structured output)  
**SLA:** Complete within 2 minutes of trigger

### 5.3 Content Review Agent

**Purpose:** First-pass automated moderation before human review.

**Workflow:**
1. Creator submits content URLs → `submission.created` event
2. Agent fetches content metadata (public URL or platform API)
3. Evaluates against mission brief via structured checklist:
   - Brand mention present
   - Required hashtags included
   - Product visibility (image/video frames)
   - No competitor mentions
   - Disclosure language (#ad / #sponsored / 已提供產品)
   - No prohibited content (brand safety)
4. Output: `{pass: boolean, flags: string[], confidence: number}`
5. If `pass && confidence > 0.85` → **auto-approve** + award points/XP
6. Otherwise → route to human reviewer with AI notes pre-populated

**Auto-approve SLA (KoLink insight):** If brand misses review SLA (default 48h), system auto-approves and awards full points. Brands who repeatedly miss SLA show a declining "Response Rate" badge visible to creators.

**Model:** Claude claude-sonnet-4 with vision  
**Audit:** All auto-approvals are logged and re-reviewable; brands can disable auto-approve

### 5.4 CRM Intelligence Agent

**Purpose:** Help brands discover, segment, and manage creator relationships.

| Capability | Trigger | Output |
|---|---|---|
| Segment Suggester | On campaign setup | Creator filter recommendation with rationale |
| Brief Writer | New mission creation | Full mission brief (requirements, content guide, compliance notes) |
| Performance Narration | Analytics page load | Natural language executive summary + recommendations |
| Churn Risk Scanner | Weekly cron | Flag creators who were active but have gone quiet |

**Model:** Claude claude-sonnet-4  

### 5.5 Finance Readiness Agent

**Purpose:** Build and maintain each creator's Finance Readiness Score with transparent coaching.

**Score Formula (0–100):**
```
Finance Readiness Score =
  (Earnings Consistency    × 25%) +
  (Mission Completion Rate × 25%) +
  (Brand Safety Score      × 20%) +
  (Affiliate Performance   × 15%) +
  (Account Age × Verified Activity × 15%)
```

**Workflow:**
1. Score recalculated **weekly** for all active creators
2. Agent generates personalised "Score Report" — explains each component + 4-week action plan
3. Milestone notifications fired on score threshold crossings

> **Disclaimer:** Finance Readiness is informational only. Any advance or lending product requires separate licensing and partner arrangement.

---

## 6. KOC Onboarding System

### 6.1 Design Principles (KoLink-Inspired)

- **Zero follower requirement** — any creator can join and complete missions from day one
- **5 steps or fewer** — full onboarding completable in under 5 minutes
- **Open missions first** — show joinable campaigns immediately, before asking for a full profile
- **No form wall** — social login only at step 1; profile enrichment is progressive

### 6.2 The 5-Step Onboarding Flow

```
Step 1: QUICK JOIN
  - Landing page: "零粉絲要求。完成任務即賺積分。"
  - CTA: "免費加入" → Google / Apple / LINE / Email+OTP
  - After auth: Creator account created with onboarding_step=1

Step 2: YOUR CATEGORIES
  - Pick 1–3 content categories (chips UI: 美容、餐飲、生活、科技、旅遊、媽媽、寵物...)
  - Skip allowed (can set later from profile)
  - onboarding_step=2 saved

Step 3: YOUR PLATFORMS
  - Connect at least 1 social handle (Instagram, Xiaohongshu, TikTok, YouTube)
  - Manual handle entry OR OAuth verification (optional upgrade)
  - Follower count is self-reported — verified later by Content Review Agent
  - onboarding_step=3 saved

Step 4: YOUR FIRST MISSION
  - System calls /onboarding/recommended-missions (Matching Agent, category-based)
  - Show 3 open UGC or Clipping missions the creator can join *right now*
  - "加入任務" CTA → mission joined, onboarding_step=4

Step 5: EARN YOUR WELCOME BONUS
  - 100 welcome points awarded
  - Referral code generated + share prompt ("邀請朋友，各得 200 分")
  - Passport stub shown (Level L0 Newcomer)
  - onboarding_step=5, onboarding_completed=true
```

### 6.3 Earnings Simulator (Pre-Signup Conversion Tool)

Prominently placed on the Creators landing page and KOCmax home:

```
Input:  Estimated monthly post reach   [slider: 1K – 500K]
Input:  Platform                       [Instagram / TikTok / XHS]
Output: Projected points/month
        Projected CPM earnings (if L2+)
        Projected XP + next level ETA
        "Join free to start earning →"
```

### 6.4 Progressive Profile Enrichment

After onboarding, the Creator App nudges creators to enrich their passport over time:

| Nudge | Trigger | Reward |
|---|---|---|
| Verify Instagram via OAuth | After first approved mission | +200 XP, "Verified" badge |
| Add portfolio samples | After L1 unlock | +100 XP |
| Complete media kit | At L2 | Unlocks brand direct enquiries |
| Connect bank/FPS for payout | At L2 | Enables cash earnings |
| Set niche specialisations | Anytime | Improves Mission Matcher ranking |

---

## 7. Creator Progression System

### 7.1 Level Definitions

| Level | Label | XP Required | Key Unlocks | Income Example |
|---|---|---|---|---|
| L0 | Newcomer 🌱 | 0 | KOC trials, open UGC, clipping missions | Product samples only |
| L1 | Explorer 🌟 | 500 | Affiliate links, review missions, points redemption | HK$200–500/mo |
| L2 | Creator 🎨 | 2,000 | UGC paid jobs, CPM track unlocked, studio access, playbooks | HK$500–2,000/mo |
| L3 | Amplifier 📢 | 6,000 | Paid campaign fees, full Copilot tools, mentor sessions | HK$2,000–8,000/mo |
| L4 | Micro-Influencer 🚀 | 15,000 | Live commerce hosting, priority mission matching, Adfoplace featured | HK$5,000–20,000/mo |
| L5 | Pro Creator 💎 | 40,000 | Brand ambassador roles, Finance Readiness unlocked | HK$15,000–50,000/mo |
| L6 | Elite 👑 | 100,000 | Custom brand deals, creator capital access, featured profile | HK$50,000+/mo |

### 7.2 XP Earning Rules

| Activity | XP |
|---|---|
| Mission joined | 10 |
| Mission submitted | 25 |
| Mission approved (standard) | 100 |
| Mission approved (premium) | 300–500 |
| Affiliate conversion | 20 each |
| CPM mission settled | 150 |
| Live commerce session | 200 |
| Perfect brand rating (5★) | 50 bonus |
| Profile completed (social verified) | 100 (one-time) |
| Referral converted | 100 each |

### 7.3 Creator Passport (Live Profile)

Built from verified platform activity. Every approved mission contributes to four core scores:

| Score | Feeds From | Weight in Matching |
|---|---|---|
| Influence | Follower counts + engagement rates (social API) | 40% |
| Content | Brand ratings on submitted content quality | 30% |
| Reliability | Submission-on-time rate, completion rate | 20% |
| Brand Safety | Compliance check pass rate, zero violations | 10% |

Creators can share a public passport link to attract inbound brand enquiries. Brands can request a passport during creator discovery.

---

## 8. KOCmax — Consumer PWA

### 8.1 Routes

| Route | Function |
|---|---|
| `/kocmax/:workspace` | Branded home — points balance, expiry countdown, quick actions, featured missions |
| `/kocmax/:workspace/mission` | Mission list with category filters + "直接加入" / "需要申請" badges |
| `/kocmax/:workspace/mission/:slug` | Mission detail + brief + Copilot hook suggestions |
| `/kocmax/:workspace/redemption` | Gift catalogue with live stock + budget remaining |
| `/kocmax/:workspace/redemption/history` | Past redemptions |
| `/kocmax/:workspace/profile` | Creator profile + passport preview |
| `/kocmax/:workspace/wallet` | Point history + earnings |
| `/kocmax/:workspace/login` | Social + email/phone login |
| `/kocmax/:workspace/explore` | Brand story + discover new missions |

### 8.2 Real-Time Features

- **Live point balance** — pulled from `PointBalance` API on every page load, with expiry countdown
- **Live stock** — `stock_remaining` polled every 30s; "已換罄" badge auto-updates
- **Mission quota bar** — `filled/quota` progress updated via Server-Sent Events
- **Budget pool** — CPM missions show `budget_remaining` + "Budget Running Low" badge at <20% remaining
- **Notifications** — new missions, point awards, payout confirmations via WebSocket

### 8.3 Brand Theming

Each workspace defines `theme.json`:

```json
{
  "primary": "#FFB5C2",
  "secondary": "#BAE6FD",
  "accent": "#A7F3D0",
  "logo_url": "https://...",
  "app_name": "KOCmax",
  "currency_label": "積分",
  "favicon_url": "https://..."
}
```

Theme tokens are injected as CSS custom properties at runtime — no separate build per brand.

### 8.4 Mission Card Design

Each mission card must display:
- Mission type badge (`UGC` / `KOC試用` / `Clipping` / `CPM`)
- Access badge (`直接加入` in green / `需要申請` in amber)
- Points or CPM rate (`HK$40/1K views`)
- Budget remaining pool bar (for CPM missions)
- Quota fill bar (`12/20 creators joined`)
- Deadline countdown
- Category chip

---

## 9. Brand CRM Dashboard

### 9.1 Mission Builder

- Structured brief builder with AI-assist ("幫我寫 brief")
- Visual mission flow node editor (React Flow — ported from `MissionFlowNode.php` logic)
- Mission type selector: UGC / Clipping / Product Trial / CPM / Live Commerce / Brand Ambassador
- Access type toggle: Open / Application-gated
- Review SLA config (default 48h — platform enforces auto-approve on breach)
- Budget escrow deposit prompt for CPM missions

### 9.2 Submission Review Queue

- Submissions sorted by: SLA clock (time remaining before auto-approve)
- AI pre-screening notes pre-populated for each submission
- Bulk approve / reject with templated rejection reason codes
- Creator history panel (past missions, ratings, earnings with this brand)
- "Response Rate" indicator on brand profile — visible to creators

### 9.3 Creator Marketplace (CRM)

- Filter by: level, category, score range, platform, location, verified status
- Full Creator Passport view inline (no page navigation)
- Add to custom segment, invite to mission, add CRM notes
- Export filtered list as CSV

### 9.4 Point & Redemption Manager

- Configure point earning rules per mission type
- Manage gift catalogue: stock levels, code upload (CSV), categories
- Point multiplier campaigns (ported from `PointMultiplierCampaign` model)
- Point expiry configuration per workspace

### 9.5 Analytics Dashboard

| Metric | Chart Type |
|---|---|
| Mission fill rate over time | Line |
| Submission approval rate | Donut |
| Creator level distribution | Bar |
| Points issued vs. redeemed | Area |
| CPM views tracked by mission | Bar |
| Top creators by campaign ROI | Table |
| Affiliate revenue by tracking code | Table |

---

## 10. Monetisation Architecture

### 10.1 Revenue Streams

| Stream | Mechanism | Rate |
|---|---|---|
| SaaS Subscription | Monthly workspace plan | HK$1,500 / HK$4,800 / HK$12,000/mo |
| Transaction Fee | % of cash / CPM payouts to creators | 15% platform take |
| AI Credits | Token usage above plan quota | HK$0.08 per 1K tokens |
| Adfoplace Listing | Featured brand/mission placement | HK$800/week |
| White-label Licensing | Third-party brands on their own domain | Custom enterprise |
| Creator Capital (v3) | Revenue advance to L5+ against earnings | Interest/fee split (requires licensing) |

### 10.2 Subscription Plans

| Feature | Starter | Growth | Enterprise |
|---|---|---|---|
| Active missions | 3 | 20 | Unlimited |
| Creator database | 500 | 5,000 | Unlimited |
| CPM missions | ✗ | ✓ | ✓ |
| AI Copilot calls/day | 20 | 100 | Unlimited |
| Auto content review | ✗ | ✓ | ✓ |
| KOCmax PWA theme | Basic | Full | White-label |
| Point multiplier campaigns | ✗ | ✓ | ✓ |
| Analytics export | ✗ | ✓ | ✓ |
| Dedicated account manager | ✗ | ✗ | ✓ |
| SLA | Best effort | 99.5% | 99.9% |

### 10.3 CPM Mission Billing Flow

1. Brand sets CPM rate (e.g. HK$40/1K views) + max budget pool (e.g. HK$3,000)
2. Budget escrowed upfront at mission creation
3. Creator submits Reel URL → system polls view count via Instagram API every 24h for 30 days
4. At day 30: `payout = (total_views / 1000) × cpm_rate`
5. Creator receives cash to earnings wallet (minus 15% platform fee)
6. Unused escrow returned to brand within 3 business days

---

## 11. Backend Service Architecture

### 11.1 Services

```
adfocate-api/               — Hono API gateway (main)
adfocate-worker-agents/     — BullMQ workers for AI agents
adfocate-worker-jobs/       — BullMQ workers for scheduled jobs
  ├── point-expiry.job.ts
  ├── mission-deadline.job.ts
  ├── xp-recalculate.job.ts
  ├── finance-score.job.ts
  ├── cpm-view-poll.job.ts   — daily view count polling for CPM missions
  ├── cpm-settle.job.ts      — 30-day settlement
  ├── sla-enforcer.job.ts    — auto-approve submissions past review SLA
  └── notification-dispatch.job.ts
adfocate-media/             — presigned URL generation for R2 uploads
adfocate-auth/              — JWT + OAuth2
```

### 11.2 Database Schema

```sql
-- Shared (platform-wide)
CREATE SCHEMA public;
-- Tables: workspaces, admin_users, billing_subscriptions, ai_usage_log

-- Per-brand (dynamic, one schema per workspace slug)
CREATE SCHEMA workspace_{slug};
-- Tables: creators, missions, mission_submissions, mission_matches,
--         point_balances, point_transactions, redemption_gifts,
--         redemption_records, tracking_codes, tracking_logs,
--         earnings_wallets, crm_segments, agent_tasks,
--         finance_score_history, notifications, activity_log
```

### 11.3 Ported Logic from fimmick-crm-point-engine

| Laravel Source | TypeScript Port | Notes |
|---|---|---|
| `MemberPointBalance::add_or_update_record()` | `PointService.addPoints()` | Atomic upsert with balance check + optimistic lock |
| `MissionFlowNode.php` (39KB) | `MissionFlowEngine` | Full node type evaluation ported |
| `KocTrackingCode` + `KocTrackingLog` | `TrackingService` | Code generation + click/conversion logging |
| `RedemptionGift` stock management | `RedemptionService.redeem()` | Optimistic lock on `stock_remaining` |
| `PointMultiplierCampaign` | `PointMultiplierService` | Applied on every `addPoints()` call |
| `MemberStamp` / `MemberStampCard` | `StampCardService` | Stamp collection + auto-reward |
| `ActivityLog` | Prisma middleware audit | Row-level change log |
| `WhatsappWebhookInbound` | Webhook service | Inbound routing preserved |

### 11.4 Key TypeScript Services

```typescript
class PointService {
  async addPoints(params: {
    creatorId: string;
    workspaceId: string;
    delta: number;           // positive = earn, negative = deduct
    sourceRef: string;
    description: string;
    availableTo?: Date;
  }): Promise<PointTransaction>

  async getBalance(creatorId: string, workspaceId: string): Promise<PointBalance>
  async expirePoints(): Promise<void>   // cron
}

class MissionFlowEngine {
  async evaluateNode(node: FlowNode, context: MissionContext): Promise<FlowResult>
  async advanceSubmission(submission: MissionSubmission): Promise<void>
  async enforceSLA(): Promise<void>     // cron — auto-approve past deadline
}

class CpmTrackingService {
  async pollViews(submissionId: string): Promise<void>   // daily cron
  async settle(submissionId: string): Promise<void>      // day 30 cron
  async getStats(creatorId: string): Promise<CpmStats>
}

class PassportService {
  async recalculateScores(creatorId: string): Promise<CreatorScores>
  async awardBadge(creatorId: string, badge: BadgeType): Promise<void>
  async checkLevelUp(creatorId: string): Promise<LevelUpResult | null>
}
```

---

## 12. Frontend Architecture

### 12.1 Portal Routing

```
/                       → Marketing site (creators, brands, adfoplace, copilot, capital pages)
/app/*                  → Creator Portal (authenticated)
  /app/dashboard        — Creator home: missions, XP, earnings summary
  /app/missions         — All missions explorer
  /app/passport         — Full Creator Passport
  /app/wallet           — Points + earnings + withdrawal
  /app/copilot          — Copilot tools workspace
  /app/affiliate        — Tracking codes + stats
/dashboard/*            → Brand Dashboard (workspace admin)
  /dashboard/missions   — Mission management
  /dashboard/creators   — Creator marketplace + CRM
  /dashboard/analytics  — Analytics
  /dashboard/settings   — Workspace settings + KOCmax theme
/kocmax/:workspace/*    → KOCmax Consumer PWA
/admin/*                → Platform admin (Fimmick internal)
```

### 12.2 State Management

- **Server state:** TanStack Query v5 — all API calls, caching, optimistic updates, SSE subscriptions
- **Client state:** Zustand — auth session, UI preferences, Copilot panel open/closed state
- **Forms:** React Hook Form + Zod — all forms with schema validated against API types

### 12.3 New Components Required

| Component | Purpose |
|---|---|
| `<MissionFlowBuilder />` | Visual drag-drop flow node editor for brands (React Flow) |
| `<PassportCard />` | Shareable Creator Passport with live animated score rings |
| `<PointTimeline />` | Visual point earn/spend history with expiry warnings |
| `<AICopilotPanel />` | Slide-in panel for all Copilot tools |
| `<EarningsSimulator />` | Interactive view-count → income calculator |
| `<MissionBudgetBar />` | Live CPM budget remaining progress bar |
| `<CreatorCRMTable />` | Advanced search table with segment tagging |
| `<RedemptionCodeManager />` | CSV upload + code pool status for brands |
| `<SLACountdown />` | SLA clock on submission cards (brand review queue) |
| `<AgentTaskMonitor />` | Admin view of AI agent job queue |

### 12.4 Retained From Current Codebase

All existing Tailwind design tokens, Radix UI components, lucide-react icons, Recharts, and all marketing page routes are kept as-is. KOCmax routes are re-pointed from static `kocmaxData.ts` to live API calls with TanStack Query.

---

## 13. Infrastructure & Deployment

### 13.1 Stack

| Service | Platform | Notes |
|---|---|---|
| Frontend SPA | Cloudflare Pages | Zero-config, global CDN |
| API Gateway | Zeabur (Node.js Docker) | Existing infra |
| Background Workers | Zeabur (Node.js Docker) | Same cluster |
| PostgreSQL | Zeabur managed Postgres | Automated backups, pgBouncer pooling |
| Redis | Zeabur managed Redis | BullMQ + API cache |
| Media Storage | Cloudflare R2 | Free egress, S3-compatible |
| AI APIs | OpenRouter | Claude + GPT-4o fallback, per-token cost tracking |
| Payments | Stripe | Subscriptions + usage metering |
| Email | Resend | Transactional email |
| SMS / Messaging | LINE Messaging API + Twilio (WA) | Notifications |

### 13.2 Environment Variables

```bash
# Core
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
APP_URL=https://api.adfocate.com

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=

# AI
OPENROUTER_API_KEY=
AI_MODEL_PRIMARY=anthropic/claude-sonnet-4
AI_MODEL_FALLBACK=openai/gpt-4o
AI_MODEL_ECONOMY=openai/gpt-4o-mini
AI_DAILY_LIMIT_STARTER=20
AI_DAILY_LIMIT_GROWTH=100

# Media
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=adfocate-media
R2_PUBLIC_URL=https://media.adfocate.com

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_GROWTH=price_xxx

# Messaging
LINE_WEBHOOK_SECRET=
WHATSAPP_TOKEN=

# Monitoring
SENTRY_DSN=
AXIOM_DATASET=
AXIOM_TOKEN=
```

### 13.3 Observability

- **Logs:** Structured JSON → Axiom
- **Errors:** Sentry (frontend + backend)
- **Uptime:** Betterstack
- **AI costs:** Custom `/admin/ai/usage` dashboard reading `ai_usage_log`
- **Queue health:** BullMQ Board (internal admin)

---

## 14. Build Phases

### Phase 1 — Foundation (Weeks 1–4)

- [ ] PostgreSQL schema + Prisma setup (public + workspace schemas)
- [ ] Hono API gateway scaffold with workspace middleware
- [ ] Auth service: JWT + Google OAuth + LINE Login
- [ ] Creator CRUD + onboarding 5-step flow
- [ ] Port `PointService` from `MemberPointBalance.php`
- [ ] KOCmax PWA wired to live point balance + real mission list
- [ ] Stripe subscription billing setup

### Phase 2 — Mission Engine (Weeks 5–8)

- [ ] Mission CRUD + submission flow (open + application-gated)
- [ ] Port `MissionFlowEngine` from Laravel `MissionFlowNode.php`
- [ ] BullMQ workers: mission deadline, point expiry, XP recalculation
- [ ] SLA enforcer job (auto-approve 48h breach)
- [ ] Redemption gift catalogue + `RedemptionService`
- [ ] KOC Tracking Code generation + click/conversion logging
- [ ] Creator Passport score calculation + level-up logic + badges
- [ ] Earnings Simulator component

### Phase 3 — AI Agents (Weeks 9–12)

- [ ] AgentTask queue scaffold
- [ ] Creator Copilot (Hook Generator, Caption Writer, Compliance Check, Brief Explainer)
- [ ] Mission Matching Agent (auto-match on `mission.created`)
- [ ] Content Review Agent (auto-approve pipeline)
- [ ] Finance Readiness Agent + weekly score job
- [ ] CRM Intelligence Agent (brief writer, segment suggester)

### Phase 4 — Brand Dashboard (Weeks 13–16)

- [ ] Brand auth + workspace admin portal
- [ ] Mission Builder UI + React Flow node editor
- [ ] Submission review queue with SLA countdown
- [ ] Creator marketplace + CRM table + segment builder
- [ ] Point multiplier campaign manager
- [ ] Analytics dashboard (Recharts)
- [ ] KOCmax theme editor

### Phase 5 — CPM Track + Monetisation (Weeks 17–20)

- [ ] CPM mission type + budget escrow flow
- [ ] Instagram view polling job (daily, 30-day window)
- [ ] CPM auto-settlement job + payout trigger
- [ ] Usage-based AI billing (Stripe metering)
- [ ] Adfoplace featured listing payments
- [ ] Earnings wallet + payout request + FPS/bank integration

### Phase 6 — Hardening (Weeks 21–24)

- [ ] Rate limiting + abuse prevention (Hono middleware)
- [ ] Bot detection signals on CPM view counts
- [ ] Load testing (k6)
- [ ] Security audit (JWT rotation, IDOR checks, SQL injection)
- [ ] PDPO (HK) + PDPA (SG) compliance review
- [ ] Creator and brand onboarding QA + UAT

---

## 15. Competitive Reference: KoLink Learnings

Source: [getkolink.com](https://getkolink.com)

### What KoLink Does Well

KoLink is a CPM-first HK creator platform with radical simplicity: brands deposit budget, set a CPM rate, creators film Reels, views are auto-tracked for 30 days, income auto-settles. Zero manual invoicing. Zero follower requirement.

### Ideas Applied to Adfocate 2.0

| KoLink Insight | Adfocate 2.0 Application |
|---|---|
| Zero follower requirement | L0 Newcomer starts earning from day one; headline: "零粉絲要求" |
| 5-min onboarding promise | 5-step onboarding flow, social login only at step 1 |
| CPM auto-settlement | `performance_cpm` mission type with 30-day view tracking + auto-settle |
| Open vs. application campaign types | "直接加入" / "需要申請" badge on every mission card |
| Budget pool transparency | `budget_remaining` bar + "Budget Running Low" badge at <20% |
| Clipping campaign type | New `clipping` mission type — creator remixes brand's existing long-form content |
| Brand escrowed upfront | Surface this to creators: "品牌預先存款，你嘅收入有保障" |
| 48h auto-approve rule | `review_sla_hours` (default 48) — system enforces; brands shown Response Rate |
| Earnings calculator (pre-signup) | Earnings Simulator on Creators landing page |
| Bot detection | Content Review Agent flags view manipulation patterns |

### What KoLink Is Missing (Adfocate's Edge)

| KoLink Gap | Adfocate 2.0 Advantage |
|---|---|
| Instagram Reels only | Multi-platform (IG, XHS, TikTok, YouTube) |
| No creator levels / progression | L0–L6 XP system + Creator Passport |
| No AI tools for creators | Full Copilot (hooks, captions, pricing, compliance) |
| No brand CRM | Creator marketplace + segment management + AI brief writer |
| No points / redemption economy | KOCmax points + gift catalogue |
| No Finance Readiness | Creator capital track for L5+ |
| HK-only | HK + SG + APAC architecture |

---

## 16. Key Technical Decisions

| Decision | Chosen | Alternative | Rationale |
|---|---|---|---|
| Backend language | TypeScript / Hono | Keep Laravel | Shared types with frontend; better AI library ecosystem; team skill fit |
| ORM | Prisma | TypeORM / Drizzle | Best DX; auto-migration; schema-first type generation |
| Multi-tenancy | Schema-per-tenant | Row-level (RLS) | Full isolation; no cross-tenant data leak risk |
| AI orchestration | Direct service calls | LangChain / LlamaIndex | Less abstraction overhead; full prompt control |
| Queue | BullMQ (Redis) | SQS / RabbitMQ | Simple setup; Redis already needed for cache |
| Frontend deployment | Cloudflare Pages (SPA) | SSR on Zeabur | Better CDN; no cold start; existing CF ecosystem |
| CPM view tracking | Platform API polling | Creator self-report | Automated; tamper-resistant; matches KoLink model |
| Review SLA enforcement | Auto-approve after 48h | Manual escalation only | Protects creators; incentivises brand responsiveness |

---

*Adfocate 2.0 — Fimmick Internal Spec — June 2026*
