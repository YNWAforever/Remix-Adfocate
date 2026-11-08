# Instagram Login publishing protocol manifest

Prepared 2026-11-04. Scope: offline preparation on `codex/kocmax-studio-stages-1-2`.

```json
{
  "status": "BLOCKED",
  "contract": null,
  "liveEnabled": false,
  "reason": "Pilot App identity, notice identity and provider revoke contract remain unverified"
}
```

This is not an executable or approved live contract. Existing fixture adapters remain available for regression tests. No Meta App, account, token, permission, redirect, deployment or database configuration was changed. Username, BioCode verification and a matching public image do not grant publishing authority.

## Evidence and unresolved facts

The official pages below were read in the in-app browser on 2026-11-04. The checked English pages describe the product, but do not verify the user's pilot App or its granted permissions. The detailed read-only record is `.superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/official-doc-observations.md`.

| Gate | Evidence available | Required before a live contract can exist |
| --- | --- | --- |
| IG-01 provider revoke | Existing `DELETE /{subject}/permissions` adapter is a fixture-tested candidate only | Product-specific method, host, path, token type, subject, success response, effect and retry rules; exact test-App confirmation. Keep revoke contract `null` |
| IG-02 identity / notices | Business Login documents an app-scoped exchange ID; profile and signed-notice IDs have separate meanings | Exact App IDs, token subject, professional profile subject and signed-notice mapping; wrong/ambiguous App or subject must not stop another grant. Keep notice rule `null` |
| IG-03 authorization product | Business Login currently documents `www.instagram.com/oauth/authorize` and the Instagram Login graph host | Resolve historical OAuth-reference host differences for the actual App/product; do not mix Facebook or Unified Login examples |
| IG-04 account and access | Professional-account product documented; no participant or App inspected | Two consented professional test accounts, correct App roles/access level, exact redirect and actually granted basic/Insights/publish scopes |
| IG-05 real smoke (existing D1 gate) | No real identity, revoke or media/metric smoke was executed | Separately approved test accounts, actual results and exact cleanup; offline tests do not clear this gate |
| Publishing capabilities (additional requirement) | Instagram Login publishing guide describes container creation, status and publication; it requires JPEG and a Meta-fetchable image | Pin API version, complete image/caption constraints, response contract and capability set. Sponsored labels/brand tags remain unsupported/unverified for this path |

## Documented product observations

- [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login): authorization code endpoint, short-token exchange on `api.instagram.com`, long-token exchange/refresh on `graph.instagram.com`, and actual granted permissions in the exchange response. The existing fixture parser is not proof of this App's identity mapping.
- [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing): Instagram Login uses `graph.instagram.com` with Instagram User tokens; basic access and `instagram_business_content_publish` are distinct requirements. The workflow creates a media container, checks its status and publishes it. Current documentation limits image publishing to JPEG. Paid-partnership fields in the shared guide are labelled for Facebook Login; their presence does not authorize use here.
- [Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights): Insights additionally requires `instagram_business_manage_insights`. Empty/unavailable values are not zero. Preserve each returned metric's period; the post-selection window is a different concept.

## Offline implementation rules

1. Keep `contract: null` and all live publishing flags off while any required identity/revoke/capability fact is unresolved. A mock contract must be visibly synthetic and may never enable a real transport.
2. Convert/validate an uploaded image before generating the final preview or obtaining mission approval. Never change approved bytes after calculating their checksum.
3. Bind preview and confirmation to owner, current account subject, grant generation, exact image checksum/caption/disclosure, mission approved version/instruction revision, authenticated session, one-use nonce and expiry.
4. Local stop is immediate and authoritative for future calls. A failed provider revoke stays pending/manual action; it cannot be reported as completed. A late already-accepted publish may still exist externally and must retain an honest receipt or unknown result.
5. One approval creates one durable intent. Ambiguous publish results become `outcome_unknown`; no blind second POST. Publishing does not award points or approve mission proof.
6. Any temporary public media URL requires a separately approved pilot: opaque short-lived bearer capability, no provider token or private Storage path, holder-readable disclosure, and expiry/revocation cleanup. None is created in this phase.

## Separate pilot evidence still required

The later pilot packet must name the App/product/version, actual scopes, two account aliases, exact allowed image/caption, processor rights, restore point, migration checksum, test window, cleanup rows and public-post cleanup. Google Drive remains outside this scope. The current protocol manifest is BLOCKED; it is not a request to connect an account now.
