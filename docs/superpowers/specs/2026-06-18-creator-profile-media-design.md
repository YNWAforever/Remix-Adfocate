# Creator Profile Media Design

Date: 2026-06-18
Status: Awaiting written-spec review
Branch: `feat/mission-brief`

## Goal

Build the v1 richer creator profile media layer for Adfocate.

Creators should be able to control their public-facing profile media without exposing private social scan data. Operators should get a stronger review surface for creator selection, while public passport viewers see only what the creator explicitly publishes.

This phase uses the approved creator-owned approach:

- Creators upload/select an avatar.
- Creators add manual portfolio links.
- Creators choose up to 3 public highlights.
- Creators explicitly publish passport-visible media.
- Operators can review avatar, portfolio links, selected highlights, profile completeness, and social scan summaries when available.
- Public passport shows only the published avatar and selected highlights.

## Non-Goals

This phase will not include:

- Operator approval gates for public profile media.
- OAuth or proof that a creator owns an Instagram or Threads account.
- Public display of unverified social handles, follower counts, engagement rates, recent post data, or post summaries.
- Automatic thumbnail scraping for portfolio links.
- AI review or moderation of uploaded images.
- Messaging, contracts, payment, or creator assignment workflows.
- New RapidAPI provider integration work. Existing or planned social scan records may be displayed privately, but this phase does not depend on live API keys.

## Product Rules

- Creator publish action governs public visibility in v1.
- Operators can review richer profile media, but they do not approve it before it appears publicly.
- Public passport can show the selected avatar URL after explicit publish.
- Public passport can show selected portfolio highlights after explicit publish, capped at 3.
- Public passport must not expose unselected `external_avatar_url`, social handles, follower counts, engagement, recent post data, provider payloads, scan errors, or operator notes.
- Profile completeness is private and operator-visible only. It is guidance, not a public badge.
- API-synced social data remains labeled as API-synced and must not imply account ownership.

## Architecture

The feature has four bounded parts.

### Creator Profile Media Controls

Authenticated creator profile editing becomes the owner of avatar and portfolio media.

It should support:

- Uploading an avatar to Supabase Storage.
- Selecting the current app avatar.
- Adding, editing, reordering, and deleting portfolio links.
- Marking up to 3 portfolio links as public highlights.
- Seeing draft vs published state.
- Publishing public passport media explicitly.

The control surface should live with existing creator profile or passport settings rather than creating a separate standalone product area.

### Private Media Data

Private profile media records store creator-owned draft inputs.

Private data includes:

- Uploaded avatar storage paths and selected avatar URL.
- Manual portfolio links.
- Highlight toggles and sort order.
- Completeness score and checklist reasons.
- References to social scan summaries when available.

Only authenticated creator-owned routes and operator review routes can read this data.

### Public Passport Snapshot

Public passport should read a public-safe snapshot rather than private profile media tables.

The snapshot contains only:

- Published avatar URL.
- Published portfolio highlights, capped at 3.
- Existing public-safe passport fields already allowed by the app.

Publishing replaces the snapshot atomically. Draft edits do not affect public passport until publish succeeds.

### Operator Review Surface

The existing operator creator review/detail surface should include profile media context.

Operators can see:

- Selected avatar.
- Portfolio links.
- Which links are selected as public highlights.
- Private completeness score and checklist.
- Existing API-synced social summaries, follower counts, engagement rate, and useful metrics when available from the trust profile work.

Operators use this information for creator selection decisions. No v1 approval state is added for profile media.

## Data Model

Exact table and column names can follow the existing Supabase conventions during planning, but the data boundary should stay as below.

### Avatar Storage

Uploaded avatars use Supabase Storage with creator-owned prefixes.

Required behavior:

- Store uploaded files under a creator-scoped path.
- Validate content type and size before accepting an upload.
- Keep the previous selected avatar if upload or selection fails.
- Do not expose storage internals in public passport payloads.

The existing `creators.avatar_url` can continue acting as the selected app avatar when that matches the current codebase. If a separate draft/published split is needed, the selected draft avatar and published avatar should be stored separately.

### `creator_portfolio_links`

One row per creator-owned portfolio item.

Fields:

- `id`
- `creator_id`
- `workspace_id`
- `url`
- `title`
- `platform_type`
- `caption`
- `sort_order`
- `public_highlight`
- `created_at`
- `updated_at`

Rules:

- `url` is required and must be a valid HTTP(S) URL.
- `title` is required.
- `platform_type` is a small controlled set such as `instagram`, `threads`, `tiktok`, `youtube`, `website`, `case_study`, or `other`.
- `caption` is optional.
- At most 3 active links per creator can have `public_highlight = true`.
- Deleting a private link removes it from the next public snapshot.

### `creator_public_profile_snapshots`

One row per creator/workspace for public passport media output.

Fields:

- `creator_id`
- `workspace_id`
- `avatar_url`
- `highlights` JSONB
- `published_at`
- `published_by`
- `updated_at`

`highlights` stores a bounded array of public-safe portfolio data:

- `url`
- `title`
- `platform_type`
- `caption`
- `sort_order`

The snapshot must not contain private IDs, social handles, follower counts, engagement data, scan summaries, operator notes, or storage paths.

### Completeness Score

The completeness score is calculated server-side from current private creator data.

Suggested v1 scoring:

- Avatar selected.
- Display name/profile basics present.
- Bio or profile summary present.
- Categories or creator niche present.
- At least one portfolio link exists.
- At least one public highlight selected.
- Social scan summary exists when the trust profile feature has data.

The API should return both score and checklist reasons to authenticated creator and operator surfaces. Public passport should never return this score.

## API Design

Authenticated creator endpoints:

- `GET /api/me/profile-media`
  - Returns draft avatar, portfolio links, selected highlights, publish status, completeness score, and checklist.

- `POST /api/me/profile-media/avatar-upload`
  - Validates requested avatar upload metadata and creates the upload path or upload action.

- `POST /api/me/profile-media/avatar-select`
  - Selects the creator's current app avatar from an allowed uploaded or explicitly chosen source.

- `POST /api/me/profile-media/portfolio`
  - Adds a portfolio link.

- `PATCH /api/me/profile-media/portfolio/:id`
  - Updates title, URL, platform/type, caption, sort order, or highlight flag.

- `DELETE /api/me/profile-media/portfolio/:id`
  - Removes a private portfolio link.

- `POST /api/me/profile-media/publish`
  - Atomically writes the public-safe avatar and up to 3 selected highlights into the public snapshot.

Operator endpoints:

- Existing creator queue/detail endpoints should include profile media summary fields.
- A creator detail response should include full operator-safe profile media, completeness checklist, and existing social scan metrics where available.

Public endpoints:

- Public passport responses should read from the public snapshot and existing public-safe passport serializers.
- Public endpoints should not query or serialize private profile media tables directly.

## Workflow

### Creator Drafting

1. Creator opens profile/passport settings.
2. Creator uploads or selects an avatar.
3. Creator adds manual portfolio links.
4. Creator marks up to 3 links as public highlights.
5. UI shows draft state, published state, and profile completeness guidance.

Draft edits remain private.

### Creator Publishing

1. Creator selects publish.
2. Server validates avatar and highlight constraints.
3. Server creates the public-safe snapshot in one transaction.
4. Public passport updates only after the transaction succeeds.

If publish fails, the existing public passport snapshot remains unchanged.

### Operator Review

1. Operator opens creator review queue or creator detail.
2. Operator sees selected avatar, portfolio links, highlights, completeness score, and available social scan summary.
3. Operator uses this data for selection decisions in the existing CRM workflow.

No operator approval is required for public profile media in v1.

### Public Passport Viewing

1. Public viewer opens a shareable passport.
2. Passport serializer loads existing public-safe data plus the public profile media snapshot.
3. Viewer sees published avatar and highlights only.
4. If no snapshot exists, the page keeps the existing safe fallback state.

## Error Handling

- Invalid portfolio URLs return field-level validation errors.
- More than 3 public highlights returns a validation error and does not change existing highlight state.
- Avatar upload failures keep the previous avatar selected.
- Avatar selection failures keep the previous avatar selected.
- Publish failures do not partially update the public snapshot.
- Missing or deleted private highlights disappear from public output only after the next successful publish/update.
- Missing Supabase Storage configuration disables upload controls with a clear authenticated UI error.

## Security And Privacy

- Creator-authenticated routes can edit only the current creator's media records.
- Operator routes can read profile media only through existing workspace and role checks.
- Public passport uses a narrow public projection/snapshot.
- Public responses must not include private record IDs, storage paths, external avatar source URLs, social handles, follower counts, engagement rates, post data, provider payloads, scan errors, completeness score, or operator notes.
- Avatar upload paths are creator-scoped.
- Uploaded file validation should cover MIME type, extension, and size.
- Portfolio URLs should be normalized and restricted to HTTP(S).
- API-synced metrics remain private/operator-visible until a later account ownership verification feature exists.

## Testing

Database and RLS tests:

- Creator can CRUD only their own portfolio links.
- Creator cannot read or mutate another creator's profile media.
- Operator can read workspace creator media through operator routes.
- Public snapshot cannot expose private social or operator fields.
- Highlight cap of 3 is enforced.

API tests:

- Portfolio CRUD validates required fields and URL format.
- Avatar upload/select preserves previous avatar on failure.
- Publish writes only public-safe fields.
- Publish is atomic when validation fails.
- Public passport payload includes published avatar and highlights only.
- Private social handles/counts/engagement/post data do not appear in public passport payloads.

UI/component tests:

- Creator profile media UI shows draft vs published state.
- Highlight selection prevents more than 3 selected highlights.
- Completeness checklist updates when avatar, profile basics, social scan, and portfolio links are present.
- Operator detail view renders avatar, portfolio, highlights, completeness, and available social scan metrics.
- Public passport renders safe fallback when no snapshot exists.

## Rollout Notes

- Existing public passport behavior should remain safe when no creator profile media snapshot exists.
- Backfill is optional for v1. Existing `creators.avatar_url` can be used as the starting selected avatar where present.
- Supabase Storage setup should be included in the implementation plan and local validation checklist.
- RapidAPI keys are not required for this phase. Social scan metrics should appear only when existing trust profile data exists.
