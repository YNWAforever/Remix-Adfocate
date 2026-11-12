# Phase 3 M3 — creator support handoff

Status: code shipped dark. The handoff only appears when a valid destination is
configured; no provider is enabled by this change.

## Configuration

Set either value in the Vercel project (Production) and redeploy:

```text
VITE_SUPPORT_WHATSAPP=+85291234567
VITE_SUPPORT_EMAIL=support@example.com
```

Both are optional and both default empty. WhatsApp is preferred when both are
valid. Malformed values are ignored rather than rendered as dead links.

## Behaviour

- Visible on a rejected submission that is closed (revision limit reached,
  deadline passed, or the schema is unavailable) and after a
  `revision_limit_reached` / `deadline_passed` submit error.
- WhatsApp opens `https://wa.me/<digits>?text=...`; email opens `mailto:` with a
  prefilled subject/body.
- The prefilled payload is only `ADFOCATE:<reason>:<submission-id>` — a stable
  reason code plus an opaque UUID. No mission titles, reviewer notes, evidence
  URLs, account data, or contact details are included.
- When neither destination validates, nothing is rendered.

## Verification

- `src/lib/support.test.ts` covers valid/invalid destinations, WhatsApp
  preference, email fallback, hiding, and payload opacity.
- `src/routes/-_app.mission.$missionSlug.test.tsx` covers hidden/visible states
  and asserts the payload contains the reason code and submission id only.

## Owner action

No support channel is live until the owner supplies the WhatsApp number or
support mailbox and redeploys. This is intentionally not a mock value.
