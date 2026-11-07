# DEV - Ads configuration change review — NOT EXECUTABLE

2026-11-07 Asia/Singapore. Native; branch codex/kocmax-studio-stages-1-2. User selected DEV - Ads and T-IG in the private intake. This document proposes changes only. No Meta settings, account connections, deployments, remote SQL, media exposure or posts are authorized.

## Existing state and preservation baseline

Prior authenticated UI observations, not refreshed during this offline task:
- DEV - Ads is a Fimmick Business App, listed Live. Instagram and Facebook Login for Business are added products.
- Four intended scopes have Standard access and No App Review requested. Dashboard additionally shows an outstanding advanced pages_show_list review action. These are App-level observations, not user-granted scopes.
- Both API defaults display v21.0. Support/feature compatibility for the pilot is not verified.
- Login Settings contains existing Google Apps Script and ads-ai-dashboard callback destinations. Full state-bearing URL values and credentials are intentionally excluded from repository documents.
- No entry was displayed on the Facebook Login for Business Configurations page. Legacy redirects are present; do not equate this with an unused App.
- Deauthorization and data-deletion request fields appeared empty. Strict redirect matching was enabled; HTTPS enforcement was disabled.
- T-IG selection, ownership, displayed IDs and Page/IG link are recorded privately. Existing business assignments do not prove a grant to this App.

Before any future mutation, take a restricted exact-value configuration inventory without secrets, identify each existing consumer/owner, and hash that inventory. Current observations are insufficient to restore all existing values. Do not store raw state-bearing URLs in Git or silently normalize them.

## Reviewable proposed deltas

| Item | Proposed change | Existing integrations / rollback | Readiness |
|---|---|---|---|
| App identity, owner, Live mode | No change | Preserve current App and roles | Selection recorded only |
| API defaults (all calls and App roles) | No change: retain observed v21.0 | No global upgrade; pilot request version must be separately validated and explicitly pinned server-side | BLOCKED on version/feature evidence |
| Login configuration | Propose one new dedicated configuration named `KOCmax P5 Technical Pilot`, only if verified product semantics permit it | Do not edit existing configurations; returned config ID must be captured after separately approved creation, never invented | BLOCKED on actual token/asset-selection contract |
| Requested scopes | Proposed exact baseline set: instagram_basic, pages_show_list, pages_read_engagement, instagram_content_publish | Do not remove existing App permissions or broaden consent. Label-specific scope only by amended review | NOT_AUTHORIZED; grant/access eligibility unverified |
| OAuth redirect allowlist | Add exactly one approved absolute HTTPS pilot callback URL; retain every existing entry byte-for-byte | Later rollback removes only the newly added exact entry after disabling pilot; never replace whole list | BLOCKED: pilot origin and deployed route absent |
| Strict redirect matching | No change; retain enabled | No wildcard redirect or relaxed matching | Preserve |
| Enforce HTTPS global setting | No change in this packet | Server must enforce HTTPS for pilot callback; global toggle needs separate existing-consumer compatibility review | Preserve; global hardening deferred |
| Deauthorization callback | Propose a product-verified shared dispatcher only after all existing consumers are inventoried | This is App-wide, not pilot-isolated. Must route known subjects to correct consumer and fail closed for ambiguity; removal after real events requires incident/owner review | BLOCKED: contract, URL, implementation and consumer coverage |
| Data-deletion callback/instructions | Select exactly the mechanism required by verified product contract; do not configure competing mechanisms speculatively | App-wide handling must cover existing data owners, original deletion workflows, evidence retention and status response; cannot default all requests to pilot | BLOCKED: contract, policy owner, URL and implementation |
| Domains / privacy policy / terms | No change to existing values | Check actual required domain entries and existing public policy before proposing any addition | NOT_VERIFIED |
| Webhooks/subscriptions | No changes | Do not use a generic webhook as substitute for deauthorization/deletion | Preserve |
| Secrets, client token, App Secret, system users | No reset, rotation, creation or permission change | Preserve existing consumers; later secret store references only, no secret values in packet | Preserve |
| Existing Page/Instagram link and people/partner assignments | No change | Existing T-IG assets are not disposable; never disconnect/delete as cleanup | Preserve |
| App Review / business verification | Prepare evidence only; no submission | External-creator eligibility distinct from App-role technical testing. Do not add broad scopes to clear review | BLOCKED on actual user class and review evidence |

The new configuration name and scope set are exact proposals. **Absolute callback values are not yet exact or approvable**, because no pilot origin is selected and no compatible live callback has been established. Do not paste placeholder URLs into Meta. No App-level callback may be enabled merely because the pilot route works.

## Proposed application-side route contract (design only)

Reserve these paths for review, not as claims that they already exist:
- `GET /integrations/meta-facebook-pilot/callback`: one-use state bound to original authenticated session, App/product and allowlisted return destination; server-side verified exchange; no tokens in response or logs.
- `POST /integrations/meta-facebook-pilot/deauthorization`: verified provider signature/subject, replay-safe dispatch across affected consumers; block pilot generation immediately without fabricating provider-revoke confirmation.
- `POST /integrations/meta-facebook-pilot/data-deletion`: verified request identity, owner-scoped original deletion workflow and required confirmation/status response according to the documented protocol.
- A deletion status route is defined only after its disclosure/authentication contract is verified; do not invent an accessible identity lookup.

Final external URLs depend on the actual hosting mount/rewrite map, not string concatenation with these suggested paths. None is a value to enter into Meta today. These endpoints must not reuse the original Instagram Login subject/token family.

Existing native surface inspected locally:
- `createNativePilotRuntime` requires injected SQL/repository, verified actor authorization, approved snapshots, proof gateway, worker publisher and media storage; construction itself starts no network, scheduler or credentials.
- `createCreatorPilotRoutes` defaults to PILOT_DISABLED without dependencies and validates authenticated commands. The publication/receipt commands are not OAuth callbacks.
- `createPilotMediaRoutes` is separate and unmounted by default, with scoped final-JPEG paths and no-store responses. An origin cannot be made public under P5.0.
- Fixture protocol evidence is explicitly distinct from provider evidence. No fixture or syntactically valid version string proves live readiness.

## Offline checks and remaining test gate

Run existing route/runtime/transport/composition and artifact/preflight tests with fixture UI disabled and mocked dependencies; record exact output in `p5-0-config-checks.log`. No source or SQL implementation is changed in this task. Existing 212-test/full-build/browser records are historical, not rerun evidence. Full-candidate freeze remains blocked until verified protocol and environment details exist.

Before later implementation/enablement, pin tests for: wrong App/subject/product; state replay/session swap; omitted scope/wrong Page; callback replay/forgery; existing-consumer event dispatch; expiry/renewal races; local revoke during awaits; no fallback from ambiguous subject to pilot; exact redirect and origin enforcement; no token/credential leaks. Any shared dispatcher must also demonstrate preservation of nonpilot consumers using mocks before real event tests are approved.

## Inputs needed to make this packet executable

1. Existing integration owners and exact restricted configuration snapshot; read-only audit can collect it, but settings must remain untouched.
2. Proposed protected pilot origin, actual route mount, privacy/data-deletion owner and policy URLs. No deployment implied by proposing a hostname.
3. Verified Meta product/version/token/notice/deletion contract plus App access requirements for T-IG and future external C1. Current v21.0 observation is not a pilot compatibility decision.
4. T-negative selection and App-role/consent evidence for named testers; no invitation or connection implied.
5. Exact approved resources, restore proof, costs, window, operators and complete candidate hash; existing offline inventory is not a deployable artifact.

## Future application and rollback sequence — separate approval required

First close protocol/consumer-impact gaps offline. Then obtain exact environment/deployment/SQL/account approvals under the P5 plan. Deploy and verify callback handlers with external writes off before proposing their actual Meta URL changes. For Meta settings: restricted before snapshot, one approved additive change at a time, readback exact values, then existing-consumer regression. Do not toggle Live mode or remove redirects to troubleshoot.

On failure: stop pilot admission/writes first, retain intent/receipt/unknown evidence; revert only the exact approved delta using the captured previous value after assessing events already received. App-wide callbacks cannot be removed blindly if that drops deletion or deauthorization events for other consumers. No token reset, asset disconnection, broad database restoration or public post deletion is a configuration rollback shortcut.

Disposition: **HOLD — reviewable proposed deltas prepared, exact runtime URLs and shared-consumer protocol coverage still missing. Zero settings changes, connections and posts.**
