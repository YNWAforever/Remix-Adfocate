# Release and recovery browser acceptance — 2026-11-06

DIRECTLY_VERIFIED in the in-app browser with local synthetic personas. This is not hosted Auth/RLS or provider acceptance.

## Healthy mock database

`controlled-pilot-private-acceptance-db`, localhost port8799, same task1931/version1951:

- Cold restart and two keyboard `r` restarts with the corrected Vite lifecycle succeeded. `vite-keyboard-restart.txt` records `server restarted. (x2)`.
- After browser reload and server restarts, receipt4cdadc1d remains mock-published; original mock handoff remains settled with400 points and exactly1 ledger entry. Refreshing the handoff does not create another reward.
- Private Brief v1/v2 remain present with revoked source content hidden and copy actions disabled. Local authorization remains revoked; platform revocation remains unverified.
- Same-workspace creator direct navigation is denied on390px and1440px; private task content is absent after the persona transition completes. Fixture role changes navigate asynchronously, so intermediate navigation frames are not final acceptance observations.
- Final widths320/390/430/1024/1440 have no horizontal overflow. A desktop-only invitation/sidebar overlap found during this pass was corrected in the development fixture wrapper. Invitation left edge is12px on mobile and242px at desktop widths, clear of the230px rail. Exact observations: `release-recovery-widths.json`.
- Existing main task fixture labels still describe the seeded approved task, while the separately labelled persisted mock handoff shows settlement. This is not evidence that the production UI or real ledger has been updated.

## Recovered copy

`controlled-pilot-visible-recovered-v6-db`, localhost port8798:

- Reopened successfully through the exclusive runtime boundary.
- Recovered requestd6e82b41 shows pending confirmation, not published success; the current visible ledger contains0 entries. These are visible-row results, not proof of the historical physical transaction outcome.
- Attempting approved-work preview is refused with content hidden and no automatic resend.
- Operator readiness on390px and1440px shows local stopped, real publication disabled, provider revocation unverified, and disabled scenario/stop controls. Operator has zero private collection panels.
- The recovered preview was closed normally with `q`; the recovered directory is retained, not promoted over the original. The healthy mock preview remains available on8799.

Screenshots in `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/`:

- `release-recovery-desktop.png`
- `release-recovery-mobile.png`
- `recovered-stop-desktop.png`
- `recovered-stop-mobile.png`

The temporary viewport override was reset. No remote SQL, provider connection, real post, deployment or live account was used.
