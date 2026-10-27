# Baseline and provenance

Audit comparison baseline and worktree HEAD: `7cfa3dc84c821719a4dff754229a591c81786c53`. The original checkout at `C:/Users/laich/Documents/Adfocate` was on `codex/creator-case-design`, HEAD `81b610448eb66a1ab683d9b458e84bdd751e8cd3`; its unrelated untracked files were preserved. Relevant later clock-only repair was compared and adopted; the audit SHA was never used to reset that checkout.

Implementation worktree: `C:/Users/laich/Documents/Adfocate/worktrees/adfocate-r1-20261023`. Remote: `https://github.com/YNWAforever/Remix-Adfocate.git`. Branch: `codex/adfocate-r1-pilot-20261023`. Supplied AGENTS graph-first discovery and RTK rules were followed; no newer on-disk AGENTS existed at intake. Model was read from the execution interface turn_context as `gpt-6.1-sol`; no model change.

Audit ZIP SHA-256: `0a9d6b96c5e7e216489b80abd45c28731d8e378eeaa6316158340e780bc859e8`. Source documents and their embedded audit remained input evidence; user authorization governed actions. Initial failures: 16 audit acceptance tests plus two expiry-clock failures. Their red logs are retained. Original 194 contract semantics are retained; only the HK date fixture time was moved within the same intended calendar day. No production expiry was extended.

Node 24.18.0 / npm 11.16.0; Node 22.23.4 was also obtained for baseline tests/build. The final delivery binds the dirty candidate with a normalized code fingerprint, since a local commit was not explicitly authorized.
