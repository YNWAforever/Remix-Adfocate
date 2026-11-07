# P5 candidate freeze evidence

Date: 2026-11-08 Asia/Singapore

Status: **HOLD_WITH_BLOCKERS** · Offline verification: **VERIFIED**

Candidate ID: `c14c2acc6a33b902913063dca87f3d1da0dba6462fe3997f70294f0e6785056c`

Evidence ID: `d99a35830a6c90340bc8ba9f53f007806d7e52923438e8f53590fc7df55a0853`

Execution allowed: **false**

## Candidate boundary

- Branch: `codex/kocmax-studio-stages-1-2`. Base HEAD: `e491e2dd30f42090458eacb82777d45b67275627`. Worktree dirty at freeze: true.
- 1,292 hashed files cover the original application, migrations, 16 reviewed SQL/rollback artifacts, dependency locks, configuration and verification tools. The previous freeze's application and migration bytes match.
- Only the release-manifest test harness changed from `0a4ac227bd15cf1307f9254d0ea66bb2a6501e179fe209d45f45494e88e50217`. The delta adds an explicit subprocess timeout, a larger outer test timeout and bounded Windows cleanup retries; product behavior is unchanged.
- The exposed database login was rotated through the Supabase dashboard after candidate preparation. The replacement was stored only in Windows Credential Manager and checked as absent from tracked files and process environment variables. No source connection was attempted.
- Credentials, environment values, local databases and evidence outputs are excluded from the candidate ID. Each command records the source fingerprint before and after execution, UTC times, exit status and the evidence file hash.

## Verification

- Full offline Vitest run: **PASS** — 4,755 passed, 363 skipped. Live-only suites remained disabled.
- Candidate and socket-free HTTP checks: **PASS** — 33 passed. The same nine HTTP contracts also passed using a temporary listener on 127.0.0.1.
- Chrome synthetic fixtures: **PASS** — 30 role/width combinations at 320, 390, 430, 1024 and 1440 px; all six roles reloaded at 390 and 1440 px.
- TypeScript: **PASS** for the application and **PASS** for verification sources. Repository lint: **PASS** (0 errors, 8 warnings); diff check: **PASS**.
- Default-off build: **PASS**. Studio build with fixtures disabled: **PASS**. Synthetic marker scans: **PASS / PASS**. Bundle isolation: PASS — 1/1 in 46 seconds.
- PGlite schema and rollback inventory: **PASS** — 103 passed; no remote SQL executed.

Chrome used the real preview routes, with bundled files and read-only synthetic API responses supplied inside the test runner. Unmatched traffic was blocked; no browser network listener was required. Creator, brand, reviewer, operator, workspace admin and finance viewer passed their expected route/control checks with no horizontal overflow. The same nine HTTP checks passed with real Node HTTP parsing over paired streams and over a temporary localhost socket.

The previous candidate and its evidence are archived. All checks and the Playwright report in this manifest are fresh for this fingerprint. The independent review of the candidate delta and record generators found no important issues. The offline run does not cover real devices, hosted authorization, a current target restore or any Meta action.

## Live gates

- B1, B9 and B10 still require owner input or explicit approval. A-R remains on hold and B6 is NOT_RUN. A prior rehearsal-only approval remains with the archived fingerprint.
- B3–B5 and B7–B8 require later approved live protocol, hosted runtime, database, Auth/RLS and media checks. B2 is not applicable to zero-post P5; the optional P5.4 post remains separate.

No deployment, remote SQL, Meta settings change, account connection, OAuth, secret loading, public media exposure, post or live reward mutation occurred.

## Reproduce locally

```powershell
npm.cmd run pilot:candidate:check
node scripts/p5-candidate-browser.mjs
$env:P5_DEV_API_TCP='0'
node node_modules/vitest/vitest.mjs run server/devApi.test.ts server/devApi.transport.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot
```

These commands leave the evidence logs intact. The complete recording group list is in `scripts/p5-candidate-verify.ps1`; use that runner in a separate evidence copy to preserve frozen logs. The TCP group needs local socket permission.

## Artifact hashes

| Artifact | SHA-256 |
| --- | --- |
| docs/superpowers/specs/2026-11-07-kocmax-p5-candidate-freeze-design.md | fbe9ce45fd15e3d01a29cfdd53152c90a848987a2d9b8ae87fc9cd3bb5b21d63 |
| docs/superpowers/plans/2026-11-07-kocmax-p5-candidate-freeze.md | 29e0aacc8f17844853850fd59d75e792c9a285ba47cb56f80ab8b2235cbdeea1 |
| scripts/integrations/pilotCandidateCore.ts | 8ffe2795b81072fcb57d87a16e0ad11465d9527a2fecb9746a774393cf62eda7 |
| scripts/integrations/pilotCandidateCore.test.ts | 903321f4804bcef99daa64b34ca616cb4e2b8f2c0a41a3afe3dd880ad50b6138 |
| scripts/integrations/pilotCandidateEvidence.ts | c2ac5074de2df2e6c3e83ac82ed1d186bb937060bfa4e7f523b20e4b440f8327 |
| scripts/integrations/pilotCandidateEvidence.test.ts | 1dd254f57d4c7baa6b2d39ccf653ef5daf753de471ba45d73ebf1908b56cb910 |
| scripts/integrations/pilotCandidateCli.ts | c61abe01bd08649020cc4b919f1d03df9171ef76c3afb5471665af757c15b027 |
| scripts/integrations/pilotCandidateCli.test.ts | a0a1d3528436725d45f955b82f6ea946b4c9389a3dafb82f9ae4e138fbdabb38 |
| scripts/integrations/pilotGateLedger.ts | 0bfd55367bc8d63cea7b45a3620c8e9cc555e81027b74a70fcca4158d2a4cbdf |
| scripts/integrations/pilotGateLedger.test.ts | de0c67713fcfb1fba67f02241c19760a3d384ef6ceff392ec57908c49d60f102 |
| scripts/integrations/p5CandidateScan.mjs | c2c980fd1659ab7af267b0626d7ccfcdb02e51931443611cf92dd1259d89f50e |
| scripts/p5-candidate-verify.ps1 | c54717731b22c45a4217f1aa0955356a4926786671b1f529c48b7e70bc07aa43 |
| scripts/p5-candidate-browser.mjs | edf033d3fc2865c8fc4cd5d4c059d80e3a6566f1892d07ff2b7f077bdc2b4eb7 |
| scripts/p5-candidate-dev.mjs | e8759f1483496c1c20e6a59336c34d3a7facb7966ff870d8f50b9480f4604a50 |
| vite.p5-candidate.config.ts | 1e80b5b0b42bb79c8ecfed8dde0f9d75ea24a039789a7c780389187bb1d4285e |
| playwright.p5-candidate.config.ts | bb131aa1cbfea4d9e68f103a9ce6bd01289f434fc5028effa00e95a631746bd1 |
| e2e/p5-candidate-freeze.spec.ts | ffe750c8541abc5340396c956cef8b336a5c9d3c3a07cd7142a428a5c23e13d9 |
| server/devApi.test.ts | 77f6728c39a646f3119e97d16bca3b58f0670032adcbc8988f3f19cf7911ebc7 |
| server/devApi.transport.test.ts | 5f2502f9840aaa9101709a1302c11e4e69276e499f9c97d91aa83d5fcb7878c5 |
| server/test/devApiTestTransport.ts | 7d69c6ea70dc6aed96146ff0f4a6af80ad98abeb334144b7f6f9e90bb95729a5 |
| scripts/creator-growth-bundle-boundary.test.ts | f88190beed65a1b8b09f3ffcdbac5cba856c72570dc5fdfc44eade19d6b9000f |
| scripts/integrations/backup-shared-db.ps1 | 21145b9b653f39a4ecb2496d09af888f6fcd45cd13aa579ce647e40967f505ab |
| scripts/integrations/open-backup.cmd | c4385de36abc5c078b7bb6382c58fa663a060bd794736b6776b5b432d73927c0 |
| scripts/release/manifest.test.ts | 16cda32421d76e581219eba852e97958051e29bcb10264f7eeb8506afd277b2b |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-scope-a-r-c14c2acc6a33b902/run-sheet.md | ec9d9a6134dd62941b38eeb5a6c703e0c81e0f5baead05b2fa80e2a98bcb4353 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-scope-a-r-c14c2acc6a33b902/store-database-credential.ps1 | e317f01147006aaa2d9708f1b1261efbc2be6ca665979c3a68bd713226439b0b |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-scope-a-r-c14c2acc6a33b902/verify-stored-database-credential.ps1 | 70bbcfc0e857006255438702cbc7ba9f658292f77832055673b2dc9ce2e9b2c5 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/credential-verification.md | 97768a1d5e5ec1bd6ae9166d6f88271fb80c8cf15cfdb11f2dda26223864f3c0 |
| docs/review/kocmax-controlled-pilot/native-offline-bundle.sql | 05c268bdd175e07efb23d60e49a23d0c46d1769dadd6bf96357ebca259d5725b |
| docs/review/kocmax-controlled-pilot/native-offline-rollback.sql | 89eff8ab00c42a9e8eecd842f70deeab267ac7afc34b1d7ae1959677923689a1 |
| docs/review/kocmax-controlled-pilot/p5-candidate-core.json | 87b06bde9dba4a6888bea22fff9de593a87c70109ce1bd341c673c92a8894d23 |
| docs/review/kocmax-controlled-pilot/p5-evidence-manifest.json | 6778578cca2237b6e8e07a98d140b2dfcf1487d8062a43480efae42274977ef9 |
| docs/review/kocmax-controlled-pilot/p5-gate-ledger.json | 4be91bffa9d7e64e3f930404becd81e4860309654b71def476fdb7f041c0e65e |
| docs/review/kocmax-controlled-pilot/p5-gate-ledger.md | 128c8569dc9f2ed9aac3402ece176f44c66f7772b46b458365c9aa33031ba2af |
| docs/review/kocmax-controlled-pilot/p5-live-run-approval-packet.md | abe79505d1a58f81fbf6a7d30c7e3dee4eedc90dcac7aee89a63935e042d48d7 |
| docs/review/kocmax-controlled-pilot/p5-scope-a-backup-restore-rehearsal.md | 4baf0d8b1ae9740786de901da7c3bc5df5db3adc28dc48dd9309a060a4fc1e03 |
| docs/review/kocmax-controlled-pilot/p5-scope-a-r-preflight.md | 766c13cfe86645a614fe49ed2c3ad5448c7b5bb792ab19f978719df444578e03 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/browser-results.json | 346e6ad44b9fcb9e9b3d24deb8abc1e40a080edfdbdb8aafd850b09e93ad8025 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/browser.log | 753ddfc46ea06beaa33b29d1027cf185a761d10c6c44c63f7d24896dfe353f4d |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/build-default.log | 819957c7afc1e029618ad543d0aaa504a7fccb10897606b348bd19f5c328b1b3 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/build-studio.log | 39912d26ba3a56e16bec4bcb2a5912de8c3b57fd3865e8ce3e94febd74255822 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/sql-inventory.log | f87e0fc5ea49101d1fd777ff87d510ba2b557f654e4bbad07780e59370b4dfdb |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/markers-default.log | e7f846971f5e16d016ce7080ef128b1763a0d6aa1f798925e91af37510a3f4f2 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/diff-check.log | d0123f9e5ffbaf591575c4085d1a07bb887399b441968a4a92b31cab50439495 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/markers-studio.log | 68ccfd7440116365dd8ffd53e3b2511978b8225bb4f13af67ca6e39687d0c509 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/lint.log | 29956cf2922a0d55267f532f4d899a42093255be0fa1f65cced8f20cfd710a8e |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/tcp-loopback.log | 8ff2b59f3f141dad05ee49f6671375352a122a6d32af28a09b084285043a03a9 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/full-suite.log | 97f7097af409b7c9e81024a14d5a63adf77067346b7a824d40181444e528e4e9 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/focused.log | 432810a2a07a4e09c0a79ce9cd2fb1ac6d550d8ead06cbaa28c66266a72d9ad7 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/types.log | c2740b84389c4b3a7a02a686f81b113bfb758e60b1e6f6ed8af76542f32d1c3e |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/verification-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/candidate-check.log | c302543a3832d265d54a3c9afeeb33efb2124c5bb746e1ef6541a5959fd726bc |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/freeze-lineage.log | e33752a6e5c67532aa941e70a9e0b39568d11bf9ebfd3289164f20a9ddcfb600 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-c14c2acc6a33b902/scoped-review.md | 572fb7d9c97b5e58fffda731c3a0de0cb6c568ec041cd521c30c9913f9f0da73 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-previous-freeze-0a4ac227bd15cf13/p5-candidate-core.json | dd69517fac80c937a6d2b24737ce7027c7354da996dfbf96b2cf7bc342c77a62 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-previous-freeze-0a4ac227bd15cf13/p5-evidence-manifest.json | c55bd4dc1282e2ba28be007c344f4c90cd2a27aae4dbe8e2c3acb3461c475313 |
