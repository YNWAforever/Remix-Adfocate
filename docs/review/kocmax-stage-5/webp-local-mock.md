# WebP to JPEG local mock flow

2026-11-05. Same codex/kocmax-studio-stages-1-2 branch; no commit/deployment/SQL/real provider calls.

Added PNG/WebP selection to the development-only native rehearsal. Existing PNG default retained. Format locks during conversion and preview and unlocks after reset. Only generated480x600 pixels enter this flow, never user uploads. Browser canvas creates WebP, then the existing decoder/JPEG encoder creates a white-backed JPEG and hashes its actual bytes. Browser MIME fallback is rejected.

WebP parser checks RIFF length, chunk bounds, padding, static VP8/VP8X dimensions and embedded VP8 consistency before decoding. Animation, duplicate frames and VP8L are rejected. Existing5MiB,4096-edge and4M-pixel limits remain. This is limited sample support, not a general WebP uploader. Reference: https://developers.google.com/speed/webp/docs/riff_container

## Verification

- Initial UI/parser tests failed, then passed. Browser revealed extended static canvas output; added a failing extended-container test and implementation.
- Independent reviewer found embedded frame dimensions were not checked. Added failing mismatch assertion, then enforced consistency and rejected VP8L. Oversized dimensions, truncated chunks and animation rejection assertions pass. Padding/duplicate-frame branches are not individually tested; pending/failure format lock is shared with existing controls but not separately asserted.
- Final60/60 selected tests across7 files pass, including opt-in production build and51-marker exclusion. No full-repository claim. Logs `.superpowers/sdd/webp-*.log`.
- Fresh actual in-app browser conversion at390x844 and1440x1000: WebP to JPEG480x600,16538bytes. Width checks384/1434, no overflow. Mobile explicit confirmation reached mock receipt before final parser tightening; both sizes reconverted successfully after tightening. No real publication/handoff/reward.
- Screenshots webp-mobile.png and webp-desktop.png. Viewport reset and preview retained on localhost8770.

Independent review was static; browser observations were directly performed by the main agent. Prior functions and fixes retained. Native provider and live Auth/RLS gates unchanged.
