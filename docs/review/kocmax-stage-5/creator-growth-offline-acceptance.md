# Creator growth: offline implementation acceptance

Updated 2026-11-04. Branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2d`; subsequent work remains uncommitted. This records the seven image/growth implementation tasks. Publication work is tracked separately in [STATUS](STATUS.md).

## Creator experience

The existing composer remains the entry point. Four curated growth cards open a private discussion for image understanding, post review, the next caption or the next growth step. A creator can select a local image and describe it manually without connecting Instagram. The development example clearly identifies its synthetic image, observation, metrics and timestamps. A real uploaded image is never described by a synthetic model result.

Evidence separates image observation, inference, official metric provenance, public-image provenance and manual descriptions. Missing measurements remain missing; Hong Kong/Traditional-Chinese coverage stays unverified without evidence. A post's lifetime metrics are labelled as that post's lifetime, not whole-account performance. Changing the selected image invalidates old reports and proposals. Unsaved work has a navigation warning. New draft persistence is disabled, so the UI says it is unsaved.

Mission, My tasks, rewards, account connections and discussion history remain directly reachable. The growth tools do not grant points or XP, approve proof or replace original task/settlement flows.

## Server and privacy boundaries

- The API trusts only the authenticated creator/workspace and canonical stored evidence. A browser cannot supply authoritative metrics, coverage, owner or report JSON.
- Multipart and JSON request streams are bounded before parsing. Uploads require one file, one rights declaration, valid MIME/structure and a trusted sanitizing decoder.
- Durable retry preparation retains the original complete command and timestamps. Partial retries resume the original work; changed commands conflict. Current ownership, lineage and grant generation are rechecked on replay.
- Private repository tables enforce owner-consistent lineage. The existing integration revoke transaction invalidates derived records and protected retry plans. No separate growth revoke authority is introduced.
- Stored assets have private paths; cleanup uses leased bounded work with expiry/retry handling. No private bytes, credential, Storage path or raw provider error appears in a browser DTO.
- The normal app mounts a guarded, disabled route factory without live dependencies. The UI has not been connected to the persistence API.

## Evidence

| Layer | Current evidence |
| --- | --- |
| Skill selection and provenance | Focused offline suites and task-level independent review accepted |
| Image/report/skill boundaries | Focused tests cover wrong binding, unsafe values, missing measurements, unknown coverage and external-call denial |
| UI | Task 5 focused23 and Studio43 passed; reviewed responsive matrix at320/390/430/1024/1440 has no overflow |
| API fix |65 route +2 client tests passed; independent re-review clears all four reported findings |
| Repository/schema |38 repository +46 PGlite schema tests passed; actual migration/RPC fixtures include revoke, interrupted retry and retention-order cases |
| Existing Studio/integration regression | Latest worker run32 passed; earlier broader Task6 suite138 passed |
| Controller verification |206 focused cases, TypeScript, targeted ESLint, ESM and Studio opt-in production build passed before the last separately tested SQL retention-order fix |
| Build isolation | Exact opt-in production scan found zero synthetic/dev markers or server RPC/publishing-policy markers |
| New browser readback |390px creator→card→thread→evidence observed;390/1440 existing mission/my/rewards/connections headings and no overflow confirmed. Desktop geometry verified; screenshot capture unavailable. Earlier Task5 visual evidence remains separate |

No entire-repository test-suite PASS is asserted. Existing unrelated release/transport checks have known baseline failures. Parallel publication/vision work may temporarily place the shared worktree in a test-first state; its final gates are separate.

## SQL and live gates

Prepared growth migration SHA-256: `BFE4FAB81BB23198A2F57C804A521B03B83C2A41815ACC86F8966AC49B2D0E43`. See the [exact SQL review and rollback packet](creator-growth-sql-review.md). It has only been executed in disposable in-process PGlite fixtures, never applied to Remix-Adfocate or a persistent environment.

Real Auth/refresh replay, hosted RLS/Storage, decoding, external vision, RapidAPI image rights, Meta App identity/revoke/notice and real publishing remain independently unverified or blocked. No production deployment, real Instagram/Google Drive connection or post publication occurred. Completing these offline tasks does not authorize those actions.
