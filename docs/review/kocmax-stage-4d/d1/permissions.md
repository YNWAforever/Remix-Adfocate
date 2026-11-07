# D1 permissions and privacy

D1 covers isolated environment preparation and local test data only. Real Instagram and Drive access, external AI, outbound messages, live rewards and production deployment remain disabled.

| Capability | Exact future scope | D1 state |
| --- | --- | --- |
| Instagram | `instagram_business_basic`, `instagram_business_manage_insights` | Disabled; IG protocol/account gates remain unresolved |
| Google Drive | `https://www.googleapis.com/auth/drive.file`, `openid` | Disabled; no token or Picker SDK request |
| Google identity | Stable verified `sub`; no email/profile scope | No OAuth exchange |
| Content | Own supported IG media or explicitly selected Drive files | Synthetic fixtures only |
| External AI | Separate processor, purpose and source consent | Disabled; no model credentials |

`drive.file` includes provider write capability. The app restricts content operations to selected-file reads; this does not reduce the provider's token scope. Do not label it a platform-enforced read-only grant. [Google scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Drive boundaries remain five files, 5 MiB/file and 8,000 Unicode excerpt characters. Supported: Google Docs, UTF-8 text and text PDFs. No folders, shortcuts, Shared Drives, OCR, encrypted PDFs, file listing, uploads, edits, deletes or sharing.

Owner/workspace isolation applies to sources, connections, selection records, conversations and Briefs. Download permission or ownership alone does not establish processing or sharing rights. Unknown rights stay private. Task transfer requires a preview and a fresh per-source/per-paragraph permission check. Missing metrics remain missing; no zero filling or inferred Hong Kong/Traditional Chinese coverage.

Browser completion tickets are single use and cleared from the URL before further work. Access tokens are short-lived Picker memory only in a future approved D2; refresh tokens, secret keys and encrypted credential material never reach browser storage, query caches, logs or documents.

Retention: unreferenced snapshots 30 days; revoked unreferenced snapshots 24 hours; minimal events 90 days. The next-batch target is one hour, not yet a deployed guarantee. Clean only recorded disposable IDs within seven days of pilot end. Verify current server membership on sensitive requests.

Google External/Testing refresh expiry for this scope set is seven days. D2's eight-day soak starts with the first specifically approved real grant, not D1 setup. [Google OAuth lifecycle](https://developers.google.com/identity/protocols/oauth2).



