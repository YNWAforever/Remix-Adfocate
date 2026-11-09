# Environment matrix (creator studio, MCP and agent flags)

Last reviewed: 2026-11-09. This is the single place to check what a flag does, its default, and what
happens when it is missing. All server flags are read per request; build-time `VITE_*` flags are baked
into the deployed bundle by the Vercel build.

## Build-time (Vite)

| Variable | Default | Effect when on |
|---|---|---|
| `VITE_STUDIO_SHELL` | unset (off) | Studio shell replaces the legacy creator layout. |
| `VITE_STUDIO_THREADS` | unset (off) | Studio discussion routes/panel are shown. |
| `VITE_PUBLIC_MISSION_PREVIEW` | unset (off) | Public mission preview surface. |
| `VITE_STUDIO_FIXTURE` | must stay unset in production | Switches the entry to the offline fixture preview. |

Changing any `VITE_*` value needs a new deployment; refreshing the page is not enough.

## Server (runtime)

| Variable | Default | Effect | Blast radius if wrong |
|---|---|---|---|
| `STUDIO_THREADS` | off | Enables studio thread/history routes. | Studio route 404s; retained history is still protected from general chat. |
| `STUDIO_MCP_ENABLED` | off | Master switch for MCP skills in the studio loop. | No MCP tool defs, no calls; chat falls back to the ten read-only account tools. |
| `STUDIO_MCP_REGISTRY` | off | Uses the workspace DB registry + consent instead of the env allowlist. | Without the tables the code falls back to `STUDIO_MCP_SERVERS`. |
| `STUDIO_MCP_SERVERS` | empty | Phase-1 env allowlist (JSON). | Only used when the registry is off/unavailable. |
| `STUDIO_MCP_OAUTH` | off | Enables provider OAuth start/callback/disconnect. | OAuth endpoints 404; registry never exposes OAuth-mode servers. |
| `MCP_OAUTH_ENCRYPTION_KEY` | empty | Base64 32-byte AES-GCM key for provider tokens. | OAuth servers stay hidden (decrypt fails closed). |
| `MCP_OAUTH_PROVIDERS` | empty | Provider config JSON (auth/token URLs, client id/secret, redirect URI, scopes). | Start returns `MCP_OAUTH_PROVIDER_UNAVAILABLE`. |
| `MCP_PILOT_TOKEN` | empty | Shared secret for the in-app read-only pilot MCP server. | Pilot server 401s; no effect on built-in tools. |
| `STUDIO_ASSISTANT_PROPOSALS` | off | Enables `propose_brief` (confirm-first, never executes writes). | No proposal card; chat stays read-only. |
| `CRON_SECRET` | empty | Bearer token for `/api/cron/*`. | Cron routes 401; retention/ refresh stop. |

## Integrations / public

| Variable | Default | Notes |
|---|---|---|
| `PUBLIC_MISSION_PUBLIC_PREVIEW` | off | Public mission preview server gate. |
| `INTEGRATIONS_MODE` | `disabled` | `disabled` = honest planning UI; `mock`/`live_pilot` enable sample journeys. |
| `ADMIN_SECRET` | unset | Break-glass operator secret (remove in B3b). |

## Operational notes

- Production currently has `STUDIO_THREADS`, `STUDIO_MCP_ENABLED`, `STUDIO_MCP_REGISTRY` on and the
  OAuth/proposal flags off. `VITE_STUDIO_FIXTURE` must never be set there.
- Optional schema (MCP registry, OAuth connections, tool traces) lives in `docs/operations/*.sql` and is
  **not** part of `supabase/migrations`; `scripts/release/optional-schema-contract.test.ts` guards that.
- Rotating `MCP_PILOT_TOKEN` requires updating both the env var and the `mcp_servers.url` row that embeds
  it for each workspace.
- Any flag that enables writes (future A3.2 server execution) must ship with its own kill switch and the
  confirmation UI; no flag should enable autonomous writes.
