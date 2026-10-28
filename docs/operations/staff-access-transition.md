# Staff access transition — D18

Status: implemented and tested locally, including the two identity-verified disposable databases. No hosted release, production query, real staff assignment or membership change is authorized or performed by this task. D15 approved curriculum remains `BLOCKED_CONTENT_NOT_PROVIDED`; UC-C18 / UC-A51 remain open.

## Independent gates

Every workspace business operation requires an active human `staff_users` identity, an active `brand_users` membership in the resolved workspace, and an active explicit `staff_workspace_roles` grant with the required capability. `brand_users.role=owner/member` does not grant a staff role. The `brand_users(user_id)` primary key stays unchanged: one workspace per user. Missing membership is a scope problem and does not require signing in again.

Global Academy/content, lessons, categories, tags and media require a separate active platform `content_editor` grant. This grant does not require or create a workspace membership. No workspace role implies editorial access. No role is inferred from JWT/user metadata, a legacy shared secret, email domain, or a brand role. Staff, membership and grant rows are read afresh by the server; existing signed-in sessions lose access on revocation.

## Workspace role matrix

| Capability | workspace_admin | operator | reviewer | finance_viewer |
| --- | --- | --- | --- | --- |
| creator.read | yes | yes | yes | — |
| creator.review, including CRM notes/shortlist | yes | yes | — | — |
| application.review | yes | yes | — | — |
| submission.review | yes | yes | yes | — |
| proof.review | yes | yes | yes | — |
| completion.approve | yes | yes | — | — |
| reward.read | yes | yes | — | yes |
| reward.settings | yes | — | — | — |
| mission.manage | yes | — | — | — |
| access.manage | yes | — | — | — |

Platform `content_editor` has only `content.manage`; it has no implicit workspace capabilities. Operator mission authoring or SLA management would require a separately reviewed policy change. The authoritative method/path policy is `server/lib/staffCapabilities.ts`; a test enumerates all mounted admin operations. Unknown operations fail closed. Existing workspace aliases, conflicting-scope checks and resource ownership checks remain enforced. The server is the security boundary; filtered navigation and controls help users discover available operations.

## Schema and privileges

Forward migration: `20261023124149_staff_access_capabilities.sql`. It creates four RLS-enabled tables, three routines and supporting indexes. It makes zero assignments and changes no old migration, membership, existing function body or financial object. The application service role can SELECT the four new tables and execute only the public, normal workspace grant wrapper. It cannot directly write these tables, call the private engine, or call the protected owner bootstrap. Browser anon/authenticated roles have no table or routine access. Do not put a service key in a client.

The single private engine performs fresh actor/target checks, scoped advisory/row locking, optimistic revision checking, the grant, audit and idempotency receipt in one transaction. Request UUIDs are globally unique. Exact replay returns the saved result only while the actor is still authorized; changed payload or stale revision returns 409. An audit failure rolls back the grant and receipt. Audit rows record the actual server actor, before/after state, reason, timestamp, actor kind and DB session user. They are access records, not a financial ledger.

## Normal grant/revocation procedure

There is no new grant-management screen in D18. An authorized workspace administrator uses the existing authenticated admin API:

1. GET `/api/admin/access` and `/api/admin/staff-access` with the explicit workspace selector. Review the saved grant/revision and target identity against the owner's approved assignment. The listing is scoped, capped at 1,000 rows with `hasMore`/total, and returns the latest 50 audit rows.
2. PUT `/api/admin/staff-access/<exact-user-uuid>` with `{ "role": "reviewer", "active": true, "expectedRevision": 0, "requestId": "<fresh-uuid>", "reason": "<owner-approved purpose>" }`. Zero means no previous grant. The server supplies the actor and workspace; client-supplied actor fields cannot impersonate another administrator. Active targets must already be active staff and members of this exact workspace. This API cannot create membership or move a user between workspaces.
3. Persist and read back the returned revision/grant. Repeat GET after refresh with the subject's existing session. Record the owner's approval reference separately in the protected operating record and use a non-sensitive reference in the reason.
4. On transport/503 uncertainty, retry the exact same request UUID and body. On 409, read the current saved state and compare before creating a new UUID with the new revision. Do not silently overwrite another operator's work. Revocation sets `active=false`; it remains possible for a known grant after the target's staff or membership has been removed.

The API forbids self-assignment and self-revocation. It cannot establish the first administrator or assign platform roles. No automatic promotion of existing staff is provided.

## Protected first administrator / platform bootstrap

This is a separately authorized DB-owner operation, never an application/API feature. Before any real execution, an owner must approve the exact target environment, workspace, subject, actor, role, active state, expected revision, reason, request UUID and approval reference. The subject and actor must already satisfy the applicable active-staff checks; a workspace target must already have its membership. A bootstrap does not authorize creating those records.

The reviewable signature is `private.bootstrap_staff_access(p_actor uuid, p_workspace uuid, p_subject uuid, p_role text, p_active boolean, p_expected_revision integer, p_request uuid, p_reason text, p_approval_ref text)`. A null workspace selects the platform `content_editor` scope. Only its protected owner has EXECUTE; `service_role`, authenticated and anon do not. The non-empty approval reference is an owner's attestation, not an independently verified approval system. Capture the result and audit/command IDs, then verify the subject's effective access. Never bypass this through direct table writes or a grant to all staff.

D18 exercises this only for newly created, exact-ID 合成 actors in the owned empty target. Their run/ID/bootstrap receipts are in `docs/verification/D18-fixtures.jsonl`. Both failed and successful runs are retained. No cleanup command is supplied because no cleanup is needed for this delivery; future removal must use only those exact owned IDs after dependency review.

## Impact review and cutover

Before coding/assignments, D18 exported anonymized impact and rollback evidence. The local pre-existing empty target had 256 active staff, 154 with active membership; the shaped target had zero. Without explicit grants the new server denies their workspace business/editorial operations. These are 合成/local counts and cannot describe production. Existing `owner/member` memberships must never be bulk-mapped to administrators.

Prepare a separately authorized read-only production review of staff, membership, existing explicit grants, schema/RPC ACLs/RLS and migration history. Review each required operation and exact subject with the workspace/platform owner. A minimal aggregate query for that review is below; it has **not** been run against production:

```sql
select count(*) filter (where s.active) as active_staff,
       count(*) filter (where s.active and b.active) as active_workspace_members
from public.staff_users s
left join public.brand_users b on b.user_id=s.user_id;
```

Any per-person export belongs in a protected owner review, with separately salted identifiers in a public receipt. The protected review must resolve actual affected people, approved grants and accountability; local tests cannot substitute for it.

After separate release authorization, sequence additive schema verification, exact owner-approved bootstrap/assignments, fresh subject/access and financial-neutrality checks, then the application enforcement cutover. Read-only diff precedes every forward migration. Do not reset, blindly push a database, change historical checksums, or use the broad legacy seed/reset helpers. The old application remains broadly staff-authorized until cutover; additive tables alone do not harden that version. An old client cannot bypass the new server's capability guard.

## Recoverable errors

| Result | Meaning and recovery |
| --- | --- |
| 401 / identity gate | Session missing/expired; use the established sign-in flow. |
| 403 `WORKSPACE_MEMBERSHIP_REQUIRED` | Signed-in staff has no active membership in this scope; owner reviews membership separately. Do not ask the user to sign in again. |
| 403 `STAFF_CAPABILITY_REQUIRED` | Owner reviews the explicit role. Retain input; the mission editor explains the required review in English and Chinese. |
| 403 `STAFF_SELF_CHANGE_FORBIDDEN` | Another authorized administrator or separately approved owner must handle the assignment. |
| 404 scope/target mismatch | Do not reveal cross-workspace resources; confirm the exact current workspace/target. |
| 409 revision/idempotency conflict | Compare persisted state, preserve input, then use a fresh request UUID for an intentional new command. |
| 503 `STAFF_CAPABILITY_SCHEMA_REQUIRED` | Schema/RPC capability is absent. Release owner reviews schema diff/history; membership changes and re-login do not fix it. |
| 503 access service unavailable | Retry access discovery or the exact uncertain command; current forms stay mounted and drafts stay entered. |

## Rollback

Prefer denying access while correcting an assignment or forward-fixing the application. Blindly reverting to the pre-D18 server restores broad staff privileges and is therefore a security regression requiring explicit owner review and compensating access controls. Retain additive tables, audit/command receipts, existing migrations and their checksums. Revoke an exact grant through a revisioned audited command; do not delete history, reset a database, promote everyone, or alter membership as a workaround. Any hosted rollback/deployment remains separately authorized and unperformed here.

## Pilot handoff

The verified local journey is Creator join/draft/revision/proof → reviewer decisions → operator completion → finance read-only handoff. Creator's DTO intentionally hides internal reward IDs; compare its safe reward/status/timing projection to the operator result and bind the single saved row to workflow/submission. Operator and finance see the same internal pending ID. Pending means an operational handoff, not payment: no new ledger entry, withdrawable balance, budget debit or payment feature.

The existing successful join awards 10 XP before the delivery baseline. D18 records that step separately and proves all delivery/proof/completion/access/browser snapshots are unchanged thereafter. D19 must renew the complete pilot's legacy/active, role, persistence, schema, outcome and neutrality evidence against the final candidate. D15's four approved real lessons and real staff transition approvals remain blockers; local role verification does not clear them.
