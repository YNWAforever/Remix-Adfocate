# AI Creator Assistant — Design Spec (Phase 1 / MVP)

**Date:** 2026-06-19
**Status:** Approved (brainstorm), pending implementation plan
**App:** `adfocate-2` (React 19 + TanStack Router + Vite + Hono API + Supabase)

## 1. Goal

A live, AI-powered Q&A and customer-service assistant embedded in the Adfocate
creator app. Creators (KOCs) ask questions in natural language and get instant,
grounded answers about how Adfocate works **and** about their own account —
backed by retrieval-augmented generation (RAG) over a curated + derived knowledge
base, plus read-only tool calls into the existing API. AI-only, real-time
streaming; no human agents.

## 2. Scope

### In scope (Phase 1 / MVP)
- RAG over a knowledge base (authored help articles **+** existing app content).
- Streaming chat answers grounded in retrieved context, with source citations.
- **Read-only** personalization via tool calls scoped to the authenticated
  creator (points/wallet, my missions & statuses, rejection reasons, level/
  passport, reward availability, mission fit).
- A floating chat widget (layout **A** — bubble → popover) mounted in the `_app`
  shell, available on all authed pages.
- Conversation persistence (history per creator).
- zh-HK (primary) + en.

### Out of scope (deferred to Phase 2)
- **Write/action tools** (redeem reward, join/apply mission, update profile) with
  confirmation guardrails — designed-for but NOT built in Phase 1.
- Human-agent handoff / live agent console (explicitly not wanted).
- Operator/admin analytics dashboards for assistant usage.
- Voice / file attachments.

## 3. Locked decisions (from brainstorm)

| Question | Decision |
|----------|----------|
| Placement / audience | Inside `adfocate-2`; creators/KOCs (logged in) |
| "Live" model | AI-only, real-time streaming; no human in the loop |
| Capabilities | RAG Q&A + personalized **read** (MVP); actions = Phase 2 |
| RAG sources | Authored help articles **and** existing content/data |
| Architecture | **A** — native Supabase `pgvector` + Vercel AI Gateway + Hono + shadcn |
| First spec | MVP slice (read-only); no write actions |
| Widget layout | **A** — floating bubble → popover (optional desktop side-panel variant) |

## 4. Architecture & data flow

Creator opens widget → types a question → `POST /api/assistant/chat` (Hono route)
using a Supabase client scoped to the session JWT (never the service key):

1. **Embed** the query via the AI Gateway embeddings model.
2. **Retrieve** top-k chunks from `kb_chunks` by pgvector cosine similarity,
   filtered by `workspace` + `locale`, above a score threshold.
3. **Tool-calling loop** (bounded iterations): the chat model may call read-only
   tools that wrap existing queries/RPCs, all RLS-scoped to the authed creator.
4. **Assemble** system prompt + retrieved context + tool results and **stream**
   answer tokens back over SSE.
5. **Persist** the conversation + messages, attaching source citations.

```
[Widget] --question--> POST /api/assistant/chat (user-scoped Supabase client)
                         | embed query (AI Gateway)
                         | pgvector top-k retrieve (kb_chunks, workspace+locale)
                         | tool-calling loop -> read tools -> existing RPCs (RLS)
                         | stream tokens (SSE) <----------------------------
                         | persist conversation + messages + citations
```

## 5. Data model (new migration `0016_assistant.sql`)

- **`kb_documents`** — `id`, `source_type` (`article` | `mission_brief` | `reward`
  | `level` | `legal`), `source_ref` (slug/FK to origin), `title`, `locale`,
  `content`, `content_hash`, `workspace` (nullable = global), `updated_at`.
- **`kb_chunks`** — `id`, `document_id` (FK, cascade), `chunk_index`, `content`,
  `embedding vector(1536)` *(dimension follows the chosen embeddings model — fix
  at implementation; e.g. 1536 for OpenAI `text-embedding-3-small`)*,
  `token_count`. Index: pgvector HNSW, cosine ops.
- **`assistant_conversations`** — `id`, `creator_id` (FK auth.users), `workspace`,
  `started_at`, `last_message_at`.
- **`assistant_messages`** — `id`, `conversation_id` (FK, cascade), `role`
  (`user` | `assistant` | `tool`), `content`, `citations jsonb`,
  `tool_calls jsonb`, `created_at`.

**RLS & grants:**
- `kb_documents` / `kb_chunks`: `SELECT` for authenticated users; queries filter
  by `workspace`/`locale`. Writes restricted to `service_role` (ingestion only).
- `assistant_conversations` / `assistant_messages`: owner-scoped
  (`creator_id = auth.uid()` / via conversation join). No cross-creator access.
- Follow the established grants pattern (explicit `service_role` grants; reload
  PostgREST schema after migration — see prior slices' incident notes).

## 6. RAG ingestion pipeline

- **Authored articles** live in-repo as markdown: `content/help/<topic>.<locale>.md`
  (topics: points, XP/leveling, mission types, submission & approval, redemption,
  wallet/cash, profile/social, account/onboarding). Front-matter: `title`,
  `locale`, optional `workspace`.
- **Derived content**: pull from existing sources — mission briefs (`0011`),
  reward catalog, level definitions (`lib/levels.ts`), T&C/privacy copy.
- **Pipeline** (re-runnable, idempotent): load → normalize → chunk (~500 tokens,
  ~50 overlap) → embed (AI Gateway, batched) → upsert into `kb_documents` /
  `kb_chunks`. Skip unchanged via `content_hash`. Delete-and-replace chunks on
  change. Runnable as an `npm` script and in CI; safe to re-run.

## 7. Backend (`server/lib/assistant/`)

> ⚠️ New server files use ESM relative imports **with `.js` extensions** (per the
> prod outage post-mortem). CI ESM-extension guard will catch omissions.

- **`retrieve.ts`** — embed query + pgvector top-k with workspace/locale filter
  and score threshold; returns chunks + document metadata for citations.
- **`tools.ts`** — read-only tool definitions; each is a thin wrapper over an
  existing query/RPC, invoked with the **user-scoped** client so RLS guarantees
  the assistant can only see the caller's data. Initial set:
  `get_my_points`, `get_my_wallet`, `get_my_missions` (+ statuses),
  `get_submission_status` (incl. rejection reason), `get_my_level` (passport),
  `list_available_rewards`, `get_mission_fit` (reuse Slice 7 matcher).
- **`chat.ts`** — builds the message array, runs the provider tool-calling loop
  (bounded max iterations), streams output. System prompt rules: answer **only**
  from retrieved context + tool results; cite sources; if the KB/tools don't
  cover it, say so plainly (no hallucination); reply in the user's locale
  (zh-HK default); refuse out-of-domain requests politely.
- **Routes:** `POST /api/assistant/chat` (SSE stream; body = conversation id +
  message), `GET /api/assistant/conversations` (+ messages) for history. Reuse
  the existing AI Gateway wrapper (`lib/llm.ts` patterns) and Hono error handling.

## 8. Frontend — chat widget (layout A)

- **Launcher:** floating 💬 bubble, bottom-right, positioned above `BottomNav`
  on mobile and clear of `SideNav` on desktop. Mounted once in `_app` shell;
  hidden on `/login`, `/auth/*`, `/onboarding` (same rule as the nav).
- **Panel:** compact popover card (brand neo-brutalist idiom: `border-2`,
  `shadow-[4px_4px_0_0_var(--color-ink)]`). On desktop (lg+) it may render as a
  wider right-side panel (optional variant; bubble→popover is the baseline).
- **Contents:** streaming message list (user/assistant bubbles), suggested
  starter questions, linkable **source citations**, typing indicator, error +
  retry state, "new chat" / history affordance.
- **Data layer:** TanStack Query hooks; SSE consumption via `fetch` streaming.
- Components: `AssistantLauncher`, `AssistantPanel`, `AssistantMessage`,
  `AssistantCitations`, `useAssistantChat`.

## 9. Security & privacy

- **User-scoped client only** in the request path — no service key reaches the
  chat route. Every tool relies on RLS for isolation.
- **Prompt-injection defense:** retrieved KB content and user text are treated as
  **data**, never instructions; the system prompt is fixed server-side. Tools
  never execute free-form input; Phase 1 has no writes, so the blast radius of a
  successful injection is read-only and already RLS-bounded.
- **Rate limiting** per creator on the chat route.
- Secrets server-side only; no PII in logs/telemetry beyond what's necessary.

## 10. Cost & performance

- Cheap chat model via AI Gateway (e.g. `deepseek/deepseek-v4-flash`, as already
  used by the Hook Generator); cap context size and tool-loop iterations.
- top-k ≈ 5; score threshold to drop weak matches.
- Batch + cache embeddings during ingestion; HNSW index for fast retrieval.
- Stream tokens for perceived latency.

## 11. Failure modes / graceful degradation

- **AI Gateway unavailable** → widget shows "助手暫時無法使用" and stays usable
  elsewhere (mirror the Hook Generator's best-effort/template fallback ethos).
- **Empty/weak retrieval** → assistant states it doesn't have that info rather
  than inventing an answer; can suggest where to look.
- **Tool error** → friendly message inline; the SSE stream must not crash.
- **Stale session (401/403)** → reuse the `_app` sign-out-and-redirect handling.

## 12. Internationalization

- zh-HK primary + en. KB chunks tagged by `locale`; retrieval filters on the
  active locale (with sensible fallback). Assistant replies in the user's locale.
  Reuse the app's existing locale resolution.

## 13. Testing strategy

- **Unit:** chunking, retrieval ranking/threshold, each read-tool wrapper (mocked
  user client — assert RLS scoping shape), citation assembly, grounding/refusal
  behavior (given empty retrieval → "don't know"), locale selection.
- **Integration:** `POST /api/assistant/chat` happy path; RLS scoping (creator A
  cannot read creator B); prompt-injection attempt is ignored; history endpoint.
  Provider is **stubbed** (no live LLM in CI). Use the `.env.test.local` local
  Supabase pattern (export into shell before running, else tests SKIP).
- No live network to the AI Gateway in CI.

## 14. Open questions / follow-ups (resolve in planning)

1. Exact embeddings model + vector dimension (fixes `vector(N)`).
2. Conversation retention policy (keep forever vs TTL) — default: keep, revisit.
3. Whether the desktop side-panel variant ships in MVP or is a fast-follow.
4. Whether suggested starter questions are static or fit-derived (reuse matcher).

## 15. Phase 2 preview (not in this spec)

Add **write/action tools** (redeem reward, join/apply mission, update profile)
behind an explicit in-widget **confirmation step** (show the exact action +
consequence; require a tap to execute). Reuse existing mutating RPCs
(`redeem_gift`, apply/join, profile update). Each write tool double-checks
eligibility server-side; never executes on inferred intent without confirmation.
