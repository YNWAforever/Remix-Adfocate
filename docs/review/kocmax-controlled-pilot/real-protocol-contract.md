# Real pilot contract — offline preparation, execution disabled

2026-11-06. Native work on `codex/kocmax-studio-stages-1-2`.

The candidate is Facebook Login, separate from the existing Instagram Login integration. Update 2026-11-07: DEV - Ads and T-IG have been selected, and their displayed identity/ownership/link details verified read-only in the private intake. Existing API defaults display v21.0, but no supported pilot version contract or actual provider grant is verified. `v99.0`, numeric example IDs and `example.invalid` are test inputs only. This contract cannot authorize deployment, SQL or external traffic.

## Required protocol evidence

Before P5, the owner must supply a restricted evidence record naming the actual App/product/version, professional Instagram account and linked Page, accepted tester roles or required external access approval, requested/granted/denied permissions, sponsor eligibility and exact partnership-label behavior. Baseline permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`; `pages_show_list` for explicit Page selection. Additional branded-content or Business Manager scopes require an amended permission decision. No Google, messaging, advertising or broad Insights access.

Freeze the selected product's token exchange, expiry/renewal and revocation semantics from official documentation plus App-specific evidence. Do not assume a refresh token exists. Signature verification must bind App, product, subject, timestamp and replay identity. Local disconnect blocks writes immediately; provider revocation stays unverified until independently confirmed. Unknown endpoint or identity semantics block that adapter rather than using an invented path.

Public documentation basis remains [Meta's collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) and [Meta's organic-content guide](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/creators/organic-content-creation.md). These references do not prove App eligibility or successful label/revoke behavior.

## Offline request boundary

`nativeHttpTransport.ts` has only an injected transport and secret reader, no default fetch or registration. Requests use a fixed `graph.facebook.com` host and pinned supplied version. Account IDs and operation keys are checked, Bearer credentials stay out of URLs, redirects are rejected, responses are bounded to 64 KiB, requests time out at 15 seconds and no request retries automatically. Authorization is rechecked after secret lookup; secret-reader failures are redacted. Responses remain untrusted until receipt validation.

The configured public-media origin may expose only the approved final JPEG via a scoped lease. It must never expose private drafts or original source URLs. Production host/TTL/cache purge and encryption/key management remain unverified. A random URL is not authorization. Image limits must be pinned to the chosen provider version before P5.

## Proposed operational limits

Seven-day attended window; C1 first, then C2–C5 only after first-result signoff. At most one approved brand JPEG per creator. At most one separately approved technical post. One publish attempt per durable intent; no automatic resubmission after ambiguity. Read recovery at most five checks, at least 60 seconds apart, or stricter provider limits. Any unknown outcome stops expansion and settlement.

Named incident owner/operator/reviewer, start/end times, actual resource IDs and monetary ceiling are not yet supplied. No paid resource creation or use is authorized. Proposed local stop target: block new writes within 60 seconds of incident acknowledgement; this cannot cancel an externally accepted post. Public post deletion is separately decided by its creator.

## Acceptance separation

Memory database, injected wire and local browser tests demonstrate offline behavior only. Real OAuth identity, remote RLS, label, public media retrieval/purge, revoke and original production settlement require the separately approved P5/P6 packet. Missing evidence is BLOCKED/NOT_RUN, never PASS or zero.

