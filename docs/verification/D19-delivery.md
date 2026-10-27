# D19 單 workspace pilot readiness

D19 的 R1 **local／disposable 驗證已完成**，正式 pilot 尚未啟用，**未部署**。D15 `BLOCKED_CONTENT_NOT_PROVIDED`、UC-C18／UC-A51 原四堂真實核准教材，以及正式現有 staff 的 owner grants／bootstrap／銜接限制保留。沒有 commit、push、merge、deploy、正式 membership／角色／資料修改、真正訊息、支付或付費 AI。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／稽核比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`，沒有reset。介面核實模型 `gpt-6.1-sol`，沒有切換。Dirty source fingerprint `e84abd4eded2a9c75443be128d00ebfb7aff7dc878db4263c7d48da34922b4e0`（311 files），本輪 28 個 code/test/schema/script/config 差異；[task-only patch](D19-changes.patch)。

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 既有引擎；legacy ACL forward repair；安全fixture／release validator | 1867 passed / 363 explicitly gated skipped / 269 files; original16+194 green; real support441+proof3, role8+core9 and Edge5 non-skipped | 未部署 | 已核實隔離目標；funded legacy／active Creator→reviewer→operator→finance 與刷新持久化 |

完整命令、counts、逐檔 assertions 及已脫敏 logs 見 [D19-delivery.json](D19-delivery.json)、[D19-test-results.json](D19-test-results.json)。Offline suite 的環境 gated skips 與已另跑且零skip的必要integration分開記錄；原16／194驗收檔及原2 pilot clock行為語義保留，沒有延長 evidence expiry。

## 核心旅程及財務證據

Creator 真實登入，legacy 無效URL保留輸入且拒絕，合法交付由reviewer批准；active經提交、修稿、再提交、發布proof修正及驗證，再由另一operator完成。Creator、operator、finance刷新讀到同一saved pending reward及15筆歷史，Creator內部reward ID仍隱藏。API另驗證transaction audit fault rollback、revision／409、並發重試去重、取消及再批准只有一個pending並保留cancelled前身。

[原始 before／after](D19-browser-neutrality.json)：XP145、points550、withdrawable125、point/cash ledger各1、budget8875、budget ledger1、庫存3均相同。9000且enforced的fixture預算，在既有legacy批准時按舊行為扣125；legacy發出的500 points／135 XP是pending前的持久化基線。Pending沒有再增加ledger、可提現額或扣預算／庫存，沒有新支付功能。沒有重設XP來製造一致。

## Schema、資料及測試修復

新增 `supabase/migrations/20261023192141_pilot_legacy_access_hardening.sql`，只收緊7個legacy表的browser grants並重申原有social欄位權限。已觀察的shaped歷史table grants原先覆蓋欄位限制；相關原有social／passport／CRM integration失敗先保留，再以forward修復轉綠。欄位及table grant關係亦參照 [Supabase官方說明](https://supabase.com/docs/guides/database/postgres/column-level-security)。不重播舊SQL、不修改舊checksum／history、不放寬membership或建立多品牌模型。

Manifest42項、587 declared／584 effective capabilities；empty72／shaped56 history。舊41manifest entries、所有舊SQL及單workspace `brand_users(user_id)` 主鍵保留；584項在兩目標皆通過。完整runtime前後tables／columns／constraints／indexes／triggers／functions／ACL／policies catalog相同，僅本輪較早已核實執行的forward history增1。見 [schema diff](D19-schema-diff.json)。

Fixture transport只包測試service client；真正app／user RLS client不包，foreign ID仍拒絕。支援40檔重跑441全綠，proof preflight3全綠；redemption、campaign結算、content、notification／cron、public passport等沿用原測試，外部provider為mock／封鎖。修正的是fixture URL realm、RPC child/parent ownership、明確合成staff能力與HK完整日fixture日期，沒有減少原assertions。所有RED、suite setup錯誤及修復後結果保留於logs。

[retention](D19-fixture-retention.json)：empty 12個run共380個Auth IDs包含失敗／未完成setup，全部保留；shaped cleanup限D19捕捉exact IDs，原有四筆public完整內容不變。沒有依test名稱掃描刪除或reset。

## 107案例與未完成項

[Case coverage](D19-case-coverage.json)逐案列owner、release scope、原稽核與本輪四層newResult；107筆mapping不是107個browser PASS。D15兩個正式內容案例保持blocked；原audit result與28findings原欄位未覆寫。R1單workspace local readiness不取代正式staff銜接、hosted release，或R2完整支援UI／manual／實機／Safari／AT／正式效能驗收。

- D15 BLOCKED_CONTENT_NOT_PROVIDED: UC-C18 / UC-A51 original four approved real lessons remain OPEN; no curriculum invented. Historical Academy seed parents are disposable support fixtures, not approved lessons.
- Formal existing staff membership/roles, owner-approved first administrator/platform bootstrap and cutover remain unapproved/open. No production membership/role/data query or modification in D19. Successful login does not confer workspace scope.
- No commit/push/merge/deploy, protected release workflow, pilot enablement, seven-day observer or schedule. R1 evidence is local/disposable readiness; hosted/production pilot remains not enabled.
- Full R2 support UI/manual acceptance is not inferred from the 441 API/DB integration assertions. Partial empty/application/campaign/content screens, hosted release identity, Safari/WebKit/physical devices, manual AT and production performance remain as scoped in case coverage.
- External social metadata/publication, real notifications/invites/SMS, payment and paid AI/provider evaluation not run. Explicit API/transport/provider mocks are labelled; persisted notifications are local database rows.
- Legacy approval intentionally issues its existing rewards and enforced budget debit on 合成 fixtures. Pending reward is separate; XP145/points550/withdrawable125, one point/cash ledger and budget8875/budget-ledger1/inventory3 are unchanged by pending completion. Existing join +10 XP is isolated, never normalized.
- Final seal caught and restored an overwritten D02 fixture cleanup test byte-for-byte; new D19 tests moved to a unique filename and final offline gates renewed. See D19-test-restoration.json.
- Four pre-existing hook lint warnings and route-test discovery warning remain; historical advisor notices retain D18 dispositions. New ACL repair adds no indexes/functions/RLS bypass.
- Only current exact IDs were mutated/cleaned. 12 empty-target runs including failed/incomplete attempts (380 Auth IDs) retained; shaped exact-ID cleanup and all four original row values preserved.

## 可審查發布材料及rollback

[release review](release-review-request.json)已更新candidate HEAD、dirty fingerprint、ordered manifest及forward SQL；commit、protected evidence digest／expiry仍null，`canDeploy=false`、`canEnablePilot=false`。正式動作須另有當次授權並走既有protected workflow；沒有啟動七日observer／排程。

Keep fail-closed access and prefer a reviewed forward repair. Do not re-grant broad historical social/passport/CRM rights or revert the pre-D18 server without explicit security/owner review. Review D19-changes.patch hunks only; preserve earlier dirty work, additive migration history/audits, pending/cancelled rows and original SQL checksums. Fixture cleanup remains exact retained IDs under separate deliberate action; no broad delete/reset. Hosted rollback not performed or authorized.

下一項計劃任務 **D20**（未開始；provider維持disabled）。

## 本輪 changed files

- `e2e/creator-operator-mission.spec.ts`
- `e2e/staff-access.spec.ts`
- `playwright.pilot.config.ts`
- `scripts/audit/configure-local-auth.mjs`
- `scripts/audit/prepare-pilot-browser.ts`
- `scripts/audit/run-integration.mjs`
- `scripts/audit/run-pilot-browser.mjs`
- `scripts/audit/run-pilot-support.mjs`
- `scripts/audit/verify-capabilities.mjs`
- `scripts/release/manifest.test.ts`
- `scripts/release/manifest.ts`
- `scripts/release/preflight.test.ts`
- `scripts/release/preflight.ts`
- `server/test/admin-staff.test.ts`
- `server/test/audit-staff-capabilities.test.ts`
- `server/test/audit-workflow-roundtrip.test.ts`
- `server/test/campaigns.test.ts`
- `server/test/content.test.ts`
- `server/test/fixture-staff-grants.test.ts`
- `server/test/fixtureStaffTransport.ts`
- `server/test/helpers.ts`
- `server/test/insights.test.ts`
- `server/test/ownedFixtureTransport.ts`
- `server/test/pilot-fixture-ownership.test.ts`
- `server/test/radar.test.ts`
- `server/test/staffCapabilityFixture.ts`
- `supabase/migrations/20261023192141_pilot_legacy_access_hardening.sql`
- `supabase/release-manifest.json`
