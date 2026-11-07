# Controlled Instagram pilot acceptance

2026-11-06. Branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Changes remain uncommitted. **Whole-stage acceptance: INCOMPLETE. Live pilot: BLOCKED.**

## Automated evidence

- Scoped final suite: **85 files, 1,439 passed, 21 skipped**. Log: `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/scoped-final-tests.log`.
- The 21 skipped checks require live integration and were deliberately disabled. This is not a full-repository or real Auth/RLS/settlement PASS.
- Default-off production build: PASS (`default-build-final.log`).
- TypeScript: PASS. ESLint: zero errors, two warnings about intentional async generation-ref invalidation in effect cleanup.
- Opt-in Studio production build and forbidden mock-marker test: PASS. Log: `bundle-final.log`. No fixture API, synthetic SQL RPC or controlled-pilot marker survives that production bundle.
- PGlite executes local test fixtures only. It does not establish a remote restore point or authorize SQL application.

## Direct in-app browser evidence

Local loopback preview `http://127.0.0.1:8795`, explicit development fixture. No external providers. Browser personas are synthetic controls, not authentication.

| Journey | Direct observation |
| --- | --- |
| Approved task preview | Final JPEG, complete caption, target account, disclosure and private-source notice; consent initially unchecked |
| Widths 320/390/430/1024/1440 | Document widths 314/384/424/1018/1434; image widths 210/280/320/382/387. No horizontal overflow. See preview-*.jpg |
| Explicit mock publish | Published state; reload preserves same intent suffix `17f7aee8` while service lives |
| Unknown mock result | One attempted publish; suffix `43609cf4` survives query/reload; remains unknown, no retry publication |
| Operator | One mock publish, zero real proof/reward; stop says local stopped and provider revocation unverified |
| Same-workspace creator / other workspace / brand member | Original task access denied; zero private pilot panels |
| Sign-out + back/forward/reload | Zero operator preparation cards and zero private publish panels |
| Keyboard / read failure | Tab from result query reaches original-proof return; injected read failure removes the private panel and shows the original task error screen |
| Existing collection | v1 copied to private draft with both source labels, saved as v3; original v1/v2 preserved; 390px has no overflow |

These observations are scenario-specific, not a complete every-role/every-width cartesian matrix. Task data and preview images are synthetic. Screenshots are not provider acceptance. Local Vite restart resets the MemoryPublishDatabase; page reload is not server restart durability.

## Original function preservation

| Existing function | Preservation / evidence |
| --- | --- |
| Creator tasks and original proof form | Existing routes remain; pilot return is explicit, sample receipt cannot submit real proof |
| Brand/operator review and rewards | Existing route/service regressions included; live settlement checks skipped |
| Private saved Brief versions/sources | Existing tests plus direct copy/save browser check; no automatic source sharing |
| Instagram legacy integration / Drive | Existing regression suites included; no real connection, Drive not enabled |
| Publishing reservation | Original repository retained; optional fixture mission discriminator; legacy binding unaffected |
| Production entry | DEV/fixture-only composition; production-marker test PASS |

## Remaining offline implementation (not excused by live blockers)

1. Compose durable repository/job store into the local HTTP service and demonstrate process-restart recovery, not just separate PGlite worker tests.
2. Complete authoritative original mission/product SQL design and product-specific OAuth composition; current fixture SQL is not deployable authority.
3. Compose this same mission through explicit proof confirmation, reviewer verification and original settlement in an isolated test engine. Current new browser flow correctly refuses all real proof/reward effects.
4. Enforce roster-wave admission and link verified pilot output into original collections; standalone metadata functions are insufficient.
5. Complete remaining browser role/session/keyboard cases and offline acceptance after those integrations.

Do not label Tasks 1–10 complete or open the real pilot on this evidence.

## Preservation audit

727 baseline file hashes were compared: 722 unchanged. Five deliberate existing-file edits are the repository mission discriminator, DEV mission entry, fixture routing, Vite mock mount and bundle-isolation test. See preservation-check.json. No unrelated baseline file was removed or changed. New stage files are additional and are not counted as unchanged baseline.
