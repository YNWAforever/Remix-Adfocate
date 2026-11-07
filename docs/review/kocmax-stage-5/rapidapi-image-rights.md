# Public-image retrieval review — BLOCKED for live use

Reviewed offline on 2026-11-04 against the approved growth Studio spec §§5–6, 8–10 and publishing pilot Task 6. The creator selected **self-upload**. No concrete RapidAPI product, subscription, image-rights record or live retrieval has been approved. This document records missing evidence; it is **not a rights PASS or legal determination**.

```json
{
  "status": "BLOCKED",
  "liveRetrievalEnabled": false,
  "approvedProvider": null,
  "approvedEndpoint": null,
  "approvedTermsRecord": null,
  "fallback": "creator_self_upload"
}
```

## Evidence needed before proposing any live adapter

All entries below are currently **null / unapproved**. A future review must supply exact values and evidence, rather than infer permission from a public Instagram URL, username, API key, marketplace listing or mock `rights: allowed` value.

| Required field | Concrete evidence to provide |
| --- | --- |
| Supplier and product identity | Legal supplier, exact RapidAPI product ID/URL, product/API version, subscribed plan and the contracting account/organization. |
| Endpoint contract | Exact method/host/path, request fields, versioned response examples and source of each image reference; documented credentials kept outside the packet. |
| Original image source | Supplier's acquisition method, supported Instagram product/account/media types and applicable platform restrictions. No private-account or other creator's material. |
| Terms and approval | Dated supplier terms/version, product-specific addenda and source references; named reviewer, approval reference, allowed purposes, validity/expiry and revocation procedure. |
| Image use rights | Separate documented permission or restriction for retrieval, display, temporary storage, image analysis, transfer to the named processor, and any redistribution. A creator declaration alone does not establish supplier rights. |
| Privacy and processing | Applicable data terms, processing/storage regions, subprocessors, transfers, training use, retention limits, deletion method/receipt and backup limitations. |
| Own-account binding | Official server-resolved subject and selected media ID/permalink, provider binding evidence, username-renaming behavior, public visibility and conflict handling. Username/caption similarity is insufficient. |
| Safe retrieval limits | Reviewed endpoint/image host allowlists, redirect policy, MIME/size limits, timeouts, cancellation, quota/429 behavior, and no scraping fallback. All are unimplemented for live use. |
| Minimization and storage | Exact matching and rights checks before retrieving/persisting image bytes; opaque references only; provider/version/fetchedAt/rights provenance kept separate from official metrics. |
| Bounded pilot and cleanup | Exact approved test account/media, covered actions, owner, isolated resources, retention/deletion verification and restore/cleanup plan. Offline plan approval covers none of these live actions. |

## Current implementation and evidence

`server/lib/creatorGrowth/publicImageProvider.ts` is retained byte-for-byte. It has only `mock` and `disabled` modes and no fetch/HTTP/redirect implementation. A forced runtime `live` mode throws `PUBLIC_IMAGE_PROVIDER_UNVERIFIED` before a request, including when extra purported approval flags/records are injected. Ordinary disabled mode preserves its existing empty-candidate interface; that means unavailable retrieval, not a verified zero-media result.

Mocks return only synthetic candidate metadata (`provenance: mock`, `sampleOnly: true`), never image bytes or metrics. `rights: allowed` in the default sample is an invented fixture value, not a statement about any real image. Unknown/denied rights remain unknown/denied and the existing exact matcher rejects them. Existing owner filtering, public visibility, canonical permalink, duplicate-candidate and cancellation tests remain intact. New regressions cover missing subject despite plausible username, URL/data/local image references, preservation of denied rights into the real matcher, and injected flags failing to enable live mode.

There is no transport to test for real 429s, timeouts or redirects. Those Task 6 cases remain **live-adapter prerequisites**, not simulated claims of provider acceptance. No product, terms, endpoint, rights or policy facts were researched over the network in this offline task.

## Fallback

Use the creator's self-upload through the existing private asset validation path. Without separately approved vision processing and purpose-bound consent, keep local preview/manual description. Uploading requires no Instagram connection and does not enable publishing, RapidAPI access, external analysis or a rights claim. No route, repository, policy, UI, database or production flag was changed here.
