# Adfocate Trust Profile Bundle Design

Date: 2026-06-17
Status: Awaiting written-spec review

## Summary

Build a Trust Profile Bundle for creator social credibility:

- Creators add Instagram and Threads handles.
- Adfocate fetches public social profile data through RapidAPI.
- The app stores API-synced follower counts, engagement metrics, profile freshness, avatar candidates, and scan history.
- Authenticated Profile and Passport screens show richer creator trust signals.
- Public passport sharing is opt-in and privacy-safe.

The product language must stay precise: API-synced means Adfocate fetched public data for a handle. It does not mean the creator owns that account.

## Chosen Approach

Use the recommended Trust Profile Bundle approach:

- Integrate Instagram via RapidAPI Instagram Scraper Stable API:
  https://rapidapi.com/thetechguy32744/api/instagram-scraper-stable-api
- Integrate Threads via RapidAPI Threads Scraper API:
  https://rapidapi.com/codenest-nestforge/api/threads-scraper-api2
- Add server-side provider adapters that normalize each provider into one shared scan result shape.
- Prefer API-synced counts over self-reported counts inside authenticated passport scoring.
- Keep public passport social data restricted until ownership verification exists in a later version.

## Goals

- Replace self-reported follower counts as the trusted internal source when public API scan data exists.
- Show creators and internal brand-facing surfaces richer profile signals: follower count, engagement rate, average likes/comments, posting frequency, freshness, and high-level content themes when available.
- Add creator-controlled avatar enrichment from scanned social profiles.
- Add opt-in public passport sharing.
- Prevent public leakage of unverified social handles, raw counts, engagement metrics, recent post data, and external avatar source URLs.
- Support manual refresh and automatic weekly refresh.

## Non-Goals

- No account ownership verification in v1.
- No public display of unverified handles, follower counts, engagement rates, or recent post data.
- No password, OAuth, or social account login flow.
- No audience demographic inference in v1.
- No large raw post archive. Store only bounded summaries needed for profile insight and trend history.

## Product Rules

- A synced count is labeled `API-synced`.
- Any synced account without ownership proof is also labeled `Ownership not verified`.
- Public passport can show derived trust badges only, such as `Social scan connected`, `Active creator`, or `Fresh profile activity`.
- Public passport cannot show raw social metrics until a later ownership verification feature exists.
- A scanned social avatar is internal by default. It may appear publicly only after the creator explicitly selects it as their Adfocate avatar.
- If scan data becomes stale, the app keeps the last successful scan and shows the last synced time.

## Architecture

The feature has four bounded parts.

### Social Scan Layer

Server-only RapidAPI integration for Instagram and Threads:

- `RAPIDAPI_KEY` stays backend-only.
- Each provider adapter owns its host, endpoint configuration, response parsing, and error mapping.
- Each adapter returns a shared `SocialScanResult`.
- Frontend code never talks directly to RapidAPI.
- Production scan actions are disabled when `RAPIDAPI_KEY` is missing.

### Creator Trust Data

Create normalized tables for scanned social accounts and scan snapshots rather than stretching the existing `creators.social_handles` JSON field.

The existing profile JSON can continue to preserve creator-entered handles for compatibility, but scoring and richer profile surfaces should prefer normalized API-synced account rows.

### Private Profile And Passport

Authenticated Profile becomes the control surface for:

- Adding Instagram and Threads handles.
- Running manual refresh.
- Seeing scan status and last synced time.
- Reviewing synced metrics.
- Choosing whether to use a scanned avatar as the Adfocate avatar.

Authenticated Passport summarizes:

- Synced audience size.
- Engagement quality.
- Freshness.
- Derived badges.
- The existing passport scores, with influence preferring API-synced counts when available.

### Public Passport

Add an unauthenticated public passport route backed by a separate public-safe serializer.

Public passport shows:

- Adfocate identity and selected app avatar.
- Existing public-safe passport scores and badges.
- Public-safe mission proof where already supported by the app.
- Derived social trust badges.

Public passport hides:

- Social handles.
- Raw follower counts.
- Engagement rates.
- Average likes/comments.
- Recent post summaries.
- External avatar source URLs.
- Scan provider payloads and errors.

## Data Model

### `creator_social_accounts`

One row per creator/platform/handle.

Fields:

- `id`
- `creator_id`
- `workspace_id`
- `platform` as `instagram` or `threads`
- `handle`
- `profile_url`
- `owner_verified` default `false`
- `api_synced_at`
- `sync_status` as `pending`, `synced`, `stale`, `failed`, or `rate_limited`
- `follower_count`
- `following_count`
- `post_count`
- `bio`
- `external_avatar_url`
- `engagement_rate`
- `avg_likes`
- `avg_comments`
- `posting_frequency`
- `freshness_score`
- `content_themes` JSONB
- `summary` JSONB for small provider-specific normalized extras
- `last_error_code`
- `last_error_message`
- timestamps

Constraints:

- Unique active account per `creator_id`, `platform`, and normalized `handle`.
- RLS limits creator access to their own rows.
- Server/admin policies allow scheduled refresh.

### `creator_social_scan_snapshots`

Bounded history for trend calculations and debugging.

Fields:

- `id`
- `account_id`
- `scanned_at`
- `provider`
- `status`
- `metrics` JSONB
- `recent_posts_summary` JSONB
- `error_code`
- `error_message`

Retention:

- Keep the latest successful snapshot.
- Keep weekly history for trend lines.
- Do not store unnecessary full raw post dumps.

### `creator_public_passports`

Controls public sharing.

Fields:

- `id`
- `creator_id`
- `public_token_hash`
- `enabled`
- `created_at`
- `revoked_at`
- `last_viewed_at`

Token rules:

- Generate a high-entropy random token.
- Store only a hash of the token.
- Revoke by disabling the row or rotating the token.
- Public route resolves a token through a server-side lookup.

### Existing `creators.avatar_url`

Continue using `creators.avatar_url` as the public app avatar.

When a scan finds a social avatar, store it as `external_avatar_url` on the social account. It only becomes public after the creator explicitly chooses it as their Adfocate avatar.

## API Design

Authenticated endpoints:

- `GET /api/me/social-accounts`
  Returns creator social accounts and private-safe scan status.

- `POST /api/me/social-accounts`
  Adds or updates a platform handle.

- `POST /api/me/social-accounts/:id/scan`
  Runs a manual scan, rate-limited per account.

- `POST /api/me/avatar/from-social`
  Copies or selects a scanned social avatar as `creators.avatar_url` after explicit creator action.

- `POST /api/me/passport/share`
  Creates or enables a public passport share link.

- `DELETE /api/me/passport/share`
  Revokes public passport sharing.

Public endpoint:

- `GET /api/public/passports/:token`
  Returns only the public-safe passport projection.

If implementation needs minor route naming changes to match existing router conventions, the implementation plan must name the final routes explicitly. The public/private separation must remain.

## Scan Data Flow

Manual scan and weekly scan use the same service:

1. Load the creator social account.
2. Check rate limits and provider availability.
3. Call the provider adapter with the platform and handle.
4. Normalize the provider response into `SocialScanResult`.
5. Upsert latest account metrics.
6. Insert a bounded scan snapshot.
7. Recompute persisted passport scores where needed.
8. Return private-safe status to the authenticated UI.

`SocialScanResult` includes:

- platform
- normalized handle
- profile URL
- follower count
- following count
- post count
- bio
- external avatar URL
- engagement rate
- average likes
- average comments
- posting frequency
- freshness score
- content themes when available
- recent posts summary when available

## Scoring

Influence scoring should prefer API-synced follower counts over existing self-reported `social_handles[].followers`.

V1 scoring behavior:

- If one or more synced social accounts exist, use synced follower counts for influence.
- If synced engagement exists, use it as a quality modifier rather than a raw public-facing number.
- If sync is stale, keep using the last successful synced value but display stale status in private UI.
- If no synced counts exist, fall back to the current self-reported logic with existing caveats.

Public passport score display should not reveal the raw social metrics behind the score while ownership remains unverified.

## UI Design

### Profile

Add a social trust area:

- Platform rows for Instagram and Threads.
- Handle input.
- Scan status pill.
- Last synced timestamp.
- Manual refresh action.
- Metrics summary after successful scan.
- Error or stale status messaging.
- Fetched avatar preview with an explicit `Use as Adfocate avatar` action.

Required labels:

- `API-synced`
- `Ownership not verified`
- `Last synced <time>`

### Authenticated Passport

Add a trust summary:

- Synced audience size.
- Engagement quality.
- Freshness.
- Posting frequency.
- Derived badges.

The authenticated passport may show raw metrics because the creator is viewing their own private data.

### Public Passport

Add opt-in sharing controls in the authenticated app:

- Create link.
- Copy link.
- Revoke link.

Public page content:

- Public Adfocate profile identity.
- Selected app avatar.
- Passport scores and badges.
- Derived social trust badges only.

The public serializer must be separate from authenticated passport serialization.

## Error Handling

- Missing `RAPIDAPI_KEY`: scanning is unavailable, handles can still be saved, and UI explains sync is not configured.
- Rate limit: keep the last successful scan, mark status `rate_limited`, and show last synced time.
- Provider failure: keep last successful scan, mark status `stale` or `failed`, and record a readable error code.
- Private/deleted/typo handle: mark failed without creating synced metrics.
- Partial provider data: store available fields and leave unavailable metrics null.
- Public token disabled or revoked: return not found.
- Public serializer failure: fail closed and return no social-derived raw data.

## Security And Privacy

- RapidAPI key is never exposed to the browser.
- Public passport tokens are high entropy and stored hashed.
- RLS scopes social account and snapshot rows to the creator.
- Scheduled refresh uses server-side privileges.
- Public passport uses an explicit allowlist serializer.
- External avatar URLs are not exposed publicly unless the creator explicitly chose that image as their Adfocate avatar.
- No provider raw responses are sent to public routes.

## Testing

Provider tests:

- Instagram fixture normalizes into `SocialScanResult`.
- Threads fixture normalizes into `SocialScanResult`.
- Missing optional fields are handled safely.
- Provider errors map to stable app error codes.

API tests:

- Add/update social account.
- Manual scan success.
- Missing key disables scan.
- Rate-limit response preserves last successful data.
- Failed scan stores failed status.
- Avatar selection requires explicit action.

Passport tests:

- API-synced follower counts are preferred over self-reported counts.
- Stale synced values keep scoring stable.
- No synced values fall back to existing self-reported behavior.

Public privacy tests:

- Public passport excludes unverified handles.
- Public passport excludes raw follower counts.
- Public passport excludes engagement metrics.
- Public passport excludes recent posts.
- Public passport excludes external avatar source URLs.
- Revoked token stops resolving.

UI tests:

- Profile scan states render correctly.
- Fetched avatar is previewed but not applied automatically.
- Share link can be created, copied, and revoked.
- Public passport renders from the public-safe payload.

## Rollout

1. Add schema and RLS.
2. Add provider adapter contracts and fixture-backed tests.
3. Add authenticated social account and scan APIs.
4. Add scoring integration.
5. Add Profile trust UI and avatar selection.
6. Add public passport token APIs and public-safe serializer.
7. Add Passport trust summary and public passport route.
8. Add weekly refresh after manual scan path is stable.
9. Configure `RAPIDAPI_KEY` when provided.

## Acceptance Criteria

- Creator can add Instagram and Threads handles.
- Creator can manually scan a handle when RapidAPI is configured.
- Scanned follower count is labeled API-synced and ownership not verified.
- Authenticated Profile shows scan status and rich metrics.
- Authenticated Passport uses API-synced follower counts for influence when available.
- Fetched social avatar does not become public automatically.
- Creator can explicitly choose a fetched avatar as the Adfocate avatar.
- Creator can create and revoke a public passport link.
- Public passport never exposes unverified social handles, raw follower counts, engagement metrics, recent post summaries, or external avatar source URLs.
- Missing API key and provider failures degrade gracefully.
- Weekly refresh can update existing synced accounts without changing public privacy rules.
