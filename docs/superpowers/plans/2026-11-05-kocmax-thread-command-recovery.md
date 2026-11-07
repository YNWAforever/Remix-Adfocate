# Thread command login recovery

Same branch, mocks only; preserve prior changes and no commits/deployment/SQL/connections.

Extend the existing latched parent recovery to chat send/status lookup, brief save/share and manual source add/revoke API401 failures. Do not retry or claim success. Unmount private UI through the existing parent latch; preserve generic error/draft behavior for non401 errors. Integration provider controls are outside this manual Studio-command scope.

Add a development-only command401 scenario that keeps reads available but rejects Studio commands and assistant requests before dispatch. Test behavior before implementation, fixture nonmutation and transient preservation. Verify mobile chat and desktop brief failure through the browser, type/lint, Studio regression/build boundary and one independent review.

Completed: all six paths covered, final155 tests pass including build isolation; type/lint and scoped whitespace pass. Mobile chat and desktop Brief failure/re-entry verified. Independent review found no severity issues and noted limited per-action non401 coverage. Evidence: `docs/review/kocmax-stage-5/thread-command-recovery.md`.
