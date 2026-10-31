# Stage 4A–4C provider contract

2026-10-31. Implementation mode: **local mock providers only**. This document distinguishes the runnable contract from real provider acceptance. All account identities, files and metrics in this phase are examples.

| Provider | Runnable in this branch | Permission boundary | Still required before a live pilot |
| --- | --- | --- | --- |
| Instagram | Single-use mock consent, partial consent, encrypted mock grant, scoped media examples, missing values, cooldown, bounded sync, consented source import | Candidate Instagram Login permissions: `instagram_business_basic`, `instagram_business_manage_insights`. No publish, message, comment-management, ads or Pages permission | Pin an actual API version and metric/media/period capability matrix; official OAuth adapter, app review/advanced-access eligibility, real token lifecycle and account tests |
| Google Drive | Mock file catalogue, explicit selection of up to five files, MIME/download/size/version checks, excerpts up to 8,000 Unicode characters, private import | Candidate `drive.file` grants selected-file access including write capability. KOCmax's application interface exposes content reads only. No folder traversal, upload or sharing-setting tool | Official OAuth/Picker adapter, reviewed redirect/origin settings, real file export/download and streaming limits, safe PDF extraction, actual ACL and revocation tests |

The browser receives no provider token in this mock phase. The encrypted example credential uses a process-local key on the local server; a restart requires mock reauthorization. Production mode refuses mock execution. This is not production key management or a real OAuth connection.

## Evidence semantics

- `sampleOnly` / `sample_only` is always true. Sources and conclusions remain `unverified`.
- A real numeric zero supplied by the mock remains zero. Missing, invalid or unsupported data never becomes zero.
- Region and language remain null when unknown. Traditional Chinese copy does not prove Hong Kong audience coverage.
- Each source retains the creator's question, provider, observation time, fetch time, version, content hash and connection generation. Reports disclose partial coverage.
- The 30-day media selection window is not a claim that all media metrics use that measurement period. Candidate metric names are internal mock keys, not a certified live endpoint schema.
- File content, titles and provider responses are untrusted data. They cannot change tool permissions, destination, owner or task state.
- The PDF example is already-extracted text, explicitly labelled as such. This build does not parse arbitrary real PDFs.

## References and verification boundary

The approved specification records the original Meta research. During this implementation, the [Meta Insights page](https://developers.facebook.com/documentation/instagram-platform/insights) could not be retrieved by the web tool; its current detailed metric/version matrix is therefore **not re-verified**. No third-party article was used to certify a live metric combination. The manifest deliberately leaves `liveApiVersion` null.

The [Google Drive scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), checked on 2026-10-31, lists `drive.file` as a per-file scope with modification capability and `drive.readonly` as a broader restricted scope. The application cannot describe `drive.file` as OAuth-level read-only. The [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) describes the real authorization-code and token lifecycle that remains outside this mock adapter.

No new service was registered, no secret was requested, and no provider/model request was used for the mock journeys. Live pilot and deployment remain separate approvals.
