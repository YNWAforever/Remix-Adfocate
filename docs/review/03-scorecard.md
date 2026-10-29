# 03 — Scorecard (journey step × dimension)

Scale: **5** solid · **4** minor issues · **3** noticeable gaps · **2** serious defect · **1** broken or missing.
Colours: 🟩 4–5 · 🟨 3 · 🟥 1–2 · ⬜ n/a.
Each cell cites the finding(s) behind a score below 4. File:line evidence is in `02-findings.md`. A ❓ marks a score that depends on an unverified runtime claim (F-001, F-049).

Dimensions:

| Abbrev | Dimension |
|---|---|
| Func | Functional correctness |
| UX | User experience |
| Data | Data integrity |
| Sec | Security |
| Priv | Privacy and compliance |
| Rel | Reliability |
| Perf | Performance |
| Obs | Observability |
| Maint | Maintainability |
| Cost | Cost and scale |
| Biz | Business gaps |

## Creator

| Stage | Func | UX | Data | Sec | Priv | Rel | Perf | Obs | Maint | Cost | Biz | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 Discovery, signup, verification | 🟨3 F-019 | 🟨3 F-030 | 🟨3 F-021 | 🟩4 | 🟥2 F-008 F-002 | 🟨3 F-036 | 🟩4 | 🟨3 F-032 | 🟩4 | 🟩5 | 🟨3 | 3.4 |
| C2 Profile, social, payout/KYC, terms | 🟨3 F-024 | 🟨3 F-018 | 🟨3 F-028 | 🟨3 F-049❓ | 🟥2 F-002 F-008 | 🟩4 | 🟩4 | 🟨3 | 🟩4 | 🟨3 F-023 | 🟥1 F-006 | 3.0 |
| C3 Create, draft, version, upload | 🟥2 F-001❓ | 🟩4 | 🟩5 | 🟩4 F-042 | 🟩4 | 🟥2 F-001❓ | 🟩4 | 🟨3 | 🟩4 | 🟩4 | 🟩4 | 3.6 |
| C4 Submission and status feedback | 🟨3 F-025 | 🟨3 F-025 F-033 | 🟩4 | 🟩5 | 🟩5 | 🟩4 | 🟩4 | 🟨3 | 🟩4 | 🟩5 | 🟨3 F-012 | 3.9 |
| C5 Review outcome (approve / reject / revise) | 🟥2 F-010 | 🟥2 F-010 F-020 | 🟨3 F-004 | 🟩4 | 🟩4 | 🟨3 F-012 | 🟩5 | 🟨3 | 🟩4 | 🟩5 | 🟨3 | 3.5 |
| C6 Publish, proof, campaign | 🟩4 F-026 | 🟨3 F-027 | 🟩4 | 🟩4 F-042 | 🟩4 | 🟩4 | 🟩4 | 🟨3 | 🟩4 | 🟨3 F-039 | 🟨3 | 3.6 |
| C7 Earnings, payouts, redemption, analytics | 🟥1 F-007 | 🟥2 F-029 F-006 | 🟥2 F-007 F-041 | 🟩4 | 🟨3 F-006 copy | 🟨3 | 🟩4 | 🟥2 | 🟨3 | 🟩4 | 🟥1 F-006 F-044 | 2.6 |
| C8 Support, disputes, deletion, export | 🟥1 F-011 F-009 | 🟥2 F-018 | 🟥2 F-009 | 🟩4 | 🟥1 F-009 F-008 | ⬜ | ⬜ | 🟥2 | 🟨3 | ⬜ | 🟥1 | 2.0 |

## Operator

| Stage | Func | UX | Data | Sec | Priv | Rel | Perf | Obs | Maint | Cost | Biz | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| O1 Login, roles, MFA, session | 🟥2 F-015 | 🟨3 F-034 | 🟩4 | 🟨3 F-035 F-016 | 🟩4 | 🟨3 F-035 | 🟩5 | 🟩4 | 🟨3 F-050 | 🟩5 | 🟥2 F-015 | 3.5 |
| O2 Dashboard, queues, KPIs, alerts | 🟨3 F-016 | 🟨3 | 🟥2 F-046 | 🟨3 F-016 | 🟨3 | 🟩4 | 🟥2 F-046 | 🟥2 F-013 | 🟩4 | 🟨3 | 🟨3 | 2.9 |
| O3a Applications | 🟩5 | 🟩4 | 🟩5 | 🟩5 | 🟩4 | 🟩5 | 🟨3 F-046 | 🟩4 | 🟩4 | 🟩4 | 🟨3 F-045 | 4.2 |
| O3b Legacy submissions review | 🟨3 F-037 | 🟥2 F-004 | 🟥2 F-004 | 🟨3 F-032 | 🟨3 | 🟨3 | 🟥2 F-046 | 🟥2 F-052 | 🟨3 | 🟩4 | 🟥2 F-045 | 2.6 |
| O3c Active-mission and proof review | 🟩4 F-038 | 🟩4 | 🟩5 | 🟩5 | 🟩4 | 🟩4 | 🟨3 F-046 | 🟩4 | 🟨3 (975-line route) | 🟩4 | 🟨3 F-045 | 3.9 |
| O4 Creator management, CRM | 🟨3 F-017 | 🟩4 | 🟨3 F-043 | 🟩4 | 🟨3 F-009 | 🟩4 | 🟩4 | 🟩4 | 🟩4 | 🟩4 | 🟥2 F-017 | 3.5 |
| O5 Mission, campaign, budget, inventory | 🟥1 F-001❓ | 🟨3 | 🟥2 F-022 F-003 F-041 | 🟥2 F-003 | 🟩4 | 🟥2 F-001❓ F-022 | 🟨3 F-046 | 🟨3 F-052 | 🟨3 | 🟨3 F-039 | 🟥2 F-039 | 2.5 |
| O6 Finance (hand-offs, payouts, exports) | 🟥2 F-007 | 🟨3 | 🟥2 F-007 | 🟩4 | 🟩4 | 🟩4 | 🟩5 (cursor) | 🟨3 | 🟩4 | 🟩4 | 🟥1 F-006 F-045 | 3.3 |
| O7 Configuration, CMS | 🟥2 F-001❓ | 🟨3 | 🟩4 | 🟨3 F-014 | 🟩4 | 🟨3 | 🟩4 | 🟨3 | 🟩4 | 🟩4 | 🟨3 F-045 | 3.4 |
| O8 Monitoring, logs, reports, exports | 🟥2 | 🟨3 | 🟨3 | 🟨3 F-032 | 🟨3 | 🟥2 F-032 | 🟨3 F-046 | 🟥1 F-032 | 🟨3 | 🟨3 F-023 | 🟥1 F-045 | 2.5 |

## Brand (secondary)

| Stage | Func | UX | Data | Sec | Priv | Rel | Perf | Obs | Maint | Cost | Biz | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1–B5 Invite, login, author, results | 🟨3 F-015 | 🟥2 F-035 | 🟥2 F-003 | 🟥2 F-003 F-034 | 🟩4 | 🟨3 | 🟩4 | 🟨3 | 🟨3 | 🟩4 | 🟥2 F-045 | 2.9 |

## Handoffs

| Handoff | Func | UX | Data | Sec | Priv | Rel | Perf | Obs | Maint | Cost | Biz | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| H1 Application → decision | 🟨3 F-038 | 🟩4 | 🟩5 | 🟩5 | 🟩4 | 🟩5 | 🟩4 | 🟨3 F-013 | 🟩4 | 🟩5 | 🟩4 | 4.2 |
| H2 Legacy submit → review | 🟨3 F-031 | 🟨3 | 🟨3 F-004 | 🟩4 | 🟩4 | 🟩4 | 🟨3 F-046 | 🟥2 F-013 | 🟨3 | 🟩5 | 🟨3 | 3.4 |
| H3 Legacy decision → creator | 🟥2 F-010 F-012 | 🟥2 F-010 | 🟩4 | 🟩5 | 🟩4 | 🟨3 F-012 | 🟩5 | 🟨3 | 🟩4 | 🟩5 | 🟨3 | 3.6 |
| H4–H6 Active review ↔ revision ↔ proof | 🟩4 F-001❓ | 🟨3 F-020 F-027 | 🟩5 | 🟩5 | 🟩4 | 🟩4 F-012 | 🟨3 F-046 | 🟩4 | 🟨3 | 🟩4 | 🟩4 | 3.9 |
| H7 Completion → finance → creator | 🟥1 F-007 F-038 | 🟥2 F-011 | 🟥2 F-007 | 🟩4 | 🟩4 | 🟨3 | 🟩4 | 🟨3 | 🟩4 | 🟩4 | 🟥1 F-006 | 2.9 |
| H8 Brand publish → creators | 🟨3 F-022 | 🟨3 | 🟥2 F-003 | 🟥2 F-003 | 🟩4 | 🟨3 | 🟩4 | 🟨3 | 🟨3 | 🟨3 F-039 | 🟨3 | 3.0 |
| H9 Session expiry mid-action | 🟨3 F-035 | 🟨3 | 🟩5 (drafts retained) | 🟨3 | 🟩4 | 🟨3 | ⬜ | 🟨3 | 🟨3 | ⬜ | ⬜ | 3.4 |

## Roll-up

**By actor:**

| Actor | Average | Weakest dimensions |
|---|---|---|
| Creator | 3.2 | Business (payout), Privacy (consent, deletion, passport), Functional on earnings and support |
| Operator | 3.3 | Observability, Business (finance, exports, bulk), Data integrity in legacy review and authoring |
| Handoffs | 3.5 | Completion → finance → creator (H7) is the single weakest link |

**By dimension (lowest first):**
1. **Business gaps:** about 2.3
2. **Observability:** about 2.8
3. **Privacy:** about 3.4, pulled down by C1, C2 and C8
4. **Data integrity:** about 3.3

Strongest: **Security on creator-scoped APIs** and **concurrency in the active-mission review flow** (mostly 4–5).
