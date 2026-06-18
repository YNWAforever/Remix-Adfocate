# Operator Creator Selection CRM Design

Date: 2026-06-18
Status: Design approved for planning
Branch: `feat/mission-brief`

## Goal

Build a CRM-lite operator workflow for reviewing creators, governing mission eligibility, and selecting creators for missions. This phase turns the trust profile work into an operator-facing decision surface without changing creator-facing access or public passport privacy.

The system should let operators:

- Review creators in a global queue.
- See richer creator context in one detail view.
- Approve, flag, or return creators to review.
- Add internal notes and maintain an audit trail.
- Shortlist and invite creators for missions.
- See review and shortlist status inside mission applicant/submission workflows.

## Non-Goals

This phase will not include:

- Messaging or chat with creators.
- Contract negotiation, pricing, or payment workflows.
- Multi-operator assignment, ownership, or task routing.
- Advanced CRM stages beyond review, shortlist, invite, accept, decline, and dismiss.
- Public approval gating for creator profile media or passports.
- Creator-facing restrictions based on operator review state.

## Auth and Governance

V1 uses the existing admin-secret operator access pattern. The schema and service layer should still model operator identity as a string field so a real Supabase-backed operator role can replace the bridge later.

Operator-only endpoints are allowed to read internal creator trust, API-synced social summary, mission history, review status, notes, shortlist state, and audit events. Public passport endpoints remain unchanged and must continue to hide social handles, follower counts, engagement, post data, unselected external avatar URLs, and private trust labels.

## Data Model

### `creator_review_statuses`

One row per creator and workspace.

Fields:

- `creator_id`
- `workspace_id`
- `status`: `needs_review`, `approved`, or `flagged`
- `risk_level`: `low`, `medium`, `high`, or `unknown`
- `summary`
- `reviewed_by`
- `last_reviewed_at`
- `created_at`
- `updated_at`

When no row exists, backend responses should treat the creator as `needs_review` with `risk_level = unknown`.

### `creator_review_notes`

Append-only internal notes.

Fields:

- `creator_id`
- `workspace_id`
- `operator_id`
- `category`: `quality`, `brand_safety`, `fit`, `social`, or `other`
- `body`
- `created_at`

Notes are operator-only and never returned to creator-facing or public APIs.

### `mission_shortlists`

One row per mission and creator pair.

Fields:

- `mission_id`
- `creator_id`
- `workspace_id`
- `status`: `shortlisted`, `invited`, `dismissed`, `accepted`, or `declined`
- `source`: `manual`, `applicant`, `match`, or `review_queue`
- `notes`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

There should be a unique constraint on `(mission_id, creator_id)`.

### `operator_audit_events`

Append-only event log for governance and selection decisions.

Fields:

- `workspace_id`
- `operator_id`
- `actor_label`
- `event_type`
- `target_type`
- `target_id`
- `creator_id`
- `mission_id`
- `metadata`
- `created_at`

Audit events should be written for review status changes, note creation, shortlist changes, and invitation state changes.

## Backend API

All endpoints are under the existing admin route group and protected by the current admin secret.

### Creator Review Queue

`GET /api/admin/creators/review`

Supports filters:

- `status`
- `risk_level`
- `mission_id`
- `q` search
- pagination

Returns a dense creator list with profile basics, level, categories, trust score summary, social sync status, review status, risk level, last activity, and relevant mission shortlist state when `mission_id` is supplied.

### Creator Detail

`GET /api/admin/creators/:id`

Returns:

- Creator profile basics and avatar.
- Categories and self-reported handles.
- Trust/passport score summary.
- API-synced social summary for operator review.
- Mission history.
- Review status.
- Internal notes.
- Shortlist memberships.
- Audit timeline.

This endpoint returns normalized operator-only metrics and does not return raw scan payload blobs.

### Review Actions

`POST /api/admin/creators/:id/review`

Body:

- `status`
- `risk_level`
- `summary`
- optional `note`

Behavior:

- Upsert review status.
- Add the optional note.
- Write an audit event.

### Notes

`POST /api/admin/creators/:id/notes`

Body:

- `category`
- `body`

Behavior:

- Append note.
- Write audit event.

### Mission Shortlist

`POST /api/admin/missions/:missionId/shortlist`

Body:

- `creator_id`
- `source`
- optional `notes`

Behavior:

- Create or restore a shortlist row.
- If the creator is flagged, require a note.
- Write audit event.

`PATCH /api/admin/missions/:missionId/shortlist/:creatorId`

Body:

- `status`
- optional `notes`

Behavior:

- Move the shortlist row through `shortlisted`, `invited`, `dismissed`, `accepted`, or `declined`.
- Block `invited` when the creator is flagged.
- Write audit event.

### Existing Admin Mission Responses

Existing applicant and submission admin payloads should include:

- creator review status
- risk level
- shortlist status for the mission, when applicable

## Mission Eligibility Rules

Operator review state affects operator workflows only.

- `approved`: shown first in mission selection and can be invited.
- `needs_review`: visible, but marked as requiring review before invite.
- `flagged`: hidden by default in selection lists, available with a filter.
- Shortlisting a flagged creator requires an explicit operator note.
- Inviting a flagged creator is blocked unless the creator is moved out of `flagged`.
- Creator-facing app behavior remains unchanged.

## UI

### `/operator/creators`

A dense review queue for repeated operator work.

Primary controls:

- Search
- Filter by review status
- Filter by risk level
- Optional mission filter
- Sort by last activity, trust score, level, and social sync freshness

Rows show:

- Creator name/avatar
- Level and categories
- Trust score summary
- Social sync state
- Review status
- Risk level
- Last activity
- Quick approve/flag actions

### `/operator/creators/:creatorId`

Creator detail view.

Sections:

- Profile header and avatar/media preview
- Trust/passport summary
- API-synced social summary
- Mission history
- Review status panel
- Internal notes
- Audit timeline
- Mission shortlist controls

### Mission Admin Surfaces

Applicant and submission lists should show:

- review status badge
- risk badge
- shortlist/invite status
- quick link to creator detail

Mission detail pages include a shortlist panel for shortlisted and invited creators.

### Review Action Modal or Drawer

Approve, flag, or set needs-review in one focused action.

Inputs:

- status
- risk level
- summary
- note

The modal should make flagged state visually serious and require a note when moving to `flagged`.

## Error Handling

- Invalid review status, risk level, note category, shortlist state, or source returns `400`.
- Unknown creator or mission returns `404`.
- Missing note when shortlisting a flagged creator returns `400`.
- Attempting to invite a flagged creator returns `409`.
- Database failures return stable `db_error` responses.

Operator UI should show inline failure states and keep the current page state intact after failed mutations.

## Testing

Schema and RLS:

- Review, notes, shortlist, and audit tables are service-role writable.
- Authenticated creators cannot read operator notes, shortlist rows, audit rows, or review rows unless explicitly exposed through a safe creator-facing endpoint in a future phase.

Admin APIs:

- Queue filters and pagination.
- Creator detail payload shape.
- Review upsert and note creation.
- Audit event creation.
- Shortlist creation and state transitions.
- Flagged creator note requirement.
- Block invite for flagged creator.

Mission Admin:

- Applicant/submission payloads include review and shortlist status.
- Flagged creators are hidden by default in selection lists.
- Approved creators sort ahead of needs-review creators.

UI:

- Review queue renders filters and rows.
- Creator detail renders trust/social/review/notes/shortlist sections.
- Review action writes status and note.
- Shortlist and invite actions update local cache.

Regression:

- Public passport still hides social handles, counts, engagement, post data, unselected external avatar URLs, and private social trust labels.

## Rollout

- Ship behind existing admin-secret operator access.
- Treat missing review rows as `needs_review`.
- Do not change creator-facing eligibility or public profile behavior.
- Keep public passport privacy unchanged.
- Add real operator roles in a later phase without changing the table shape.
