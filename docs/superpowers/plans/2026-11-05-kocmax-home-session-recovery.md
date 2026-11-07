# Home and starter session recovery

Same branch, mocks only; no deployment, SQL, provider or commits. Preserve existing successful flows and transient retry.

Observed gap: StudioHome recent history renders cached titles even on unauthorized errors; the starter treats create-thread 401 as a retryable request.

Share the existing login-required notice. On home me/balance/history 401, hide home private data and creation controls. Read history with the existing query key only when Studio threads are enabled. On starter mutation 401, clear its replay intent, hide controls and notify its parent so cached home/workspace content is hidden. No automatic sign-out, login, write replay or draft persistence. Keep transient mutation errors and request UUID retry unchanged.

Test cached read errors, command rejection, disabled feature behavior and transient retry before implementation; verify mobile/desktop with existing mock 401 scenario, build isolation, type/lint, and independent review. This is UI recovery only, not real session/Auth/RLS acceptance.

Completed: initial6 RED failures; review finding added4 RED cases; final147 tests passed including build exclusion. Mobile/desktop navigation and persistent containment verified. Review P2 fixed by latching unauthorized state for the mounted home/workspace; no other findings. Evidence in `docs/review/kocmax-stage-5/home-session-recovery.md`.
