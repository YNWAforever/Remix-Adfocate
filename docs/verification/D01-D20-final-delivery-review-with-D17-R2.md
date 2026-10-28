# D01–D20 最終交付覆核（納入 D17 R2）

交付紀錄已覆核並整合；正式發布與pilot enablement仍 **HOLD**。本輪只改交付文件，沒有修改程式、測試、SQL、正式資料或membership／角色，沒有commit、push、merge或deploy。D15、具名advisor owner／裝置／hosted、正式staff及真實provider disabled全部保留。

入口：[adfocate-delivery.json](adfocate-delivery.json) → `finalDeliveryReview`；[機讀覆核](D01-D20-final-delivery-review-with-D17-R2.json)、[case matrix](final-review-D17-case-coverage.json)、[test accounting](final-review-D17-test-accounting.json)、[integrity](final-review-D17-integrity.json)、[本輪文件變更](final-review-D17-changed-files.json)。舊的D20時點 [最終報告](D01-D20-final-delivery-review.md) 保留為歷史；R2 UI及D17原報告亦未覆寫。

## 版本與證據範圍

- Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／audit comparison `7cfa3dc84c821719a4dff754229a591c81786c53`。Dirty工作保留，沒有新commit。
- Current source fingerprint `cdf8597d00d4cf716823a420296cb0e40ba1fa13e0fa11ca7feb735f8f04c996`／348 records；source與940份先前封存證據在本輪改文件前全部hash吻合。Review本身沒有改source，所以沒有重跑八分鐘full suite或新增runtime驗收。
- 最新同source full suite是 **1954 pass／363 gated skip／0fail／275 files**；原16＋194通過。這是已封存D17結果，本輪重新核對逐assertion與source binding，不是宣稱本輪再執行產品測試。
- 最後完整真實owned legacy/active/proof/reward交接仍是D19 fingerprint `e84abd4eded2a9c75443be128d00ebfb7aff7dc878db4263c7d48da34922b4e0`；R2持久化8 browser與D17品質5＋1各保留自己的source／scope。D17 full browser後只有advisor reader及其測試改動，UI/API/SQL hash相同，見 [source binding](D17-R2-runtime-source-binding.json)。本輪沒有重新稱當前整份candidate為R1 verified。

## D01–D20 四層核對

表內較早任務數字為已封存歷史測試；「real local」只指已核實disposable Auth/API/RLS/DB，所有任務均未部署。

| Task | Code | Test evidence | Deployment | Runtime／限制 |
| --- | --- | --- | --- | --- |
| D01 | 保留原稽核及clock修正 | 本輪重算同source原16＋194綠 | 未部署 | 正式expiry不變；原失敗及一項HK fixture時間修正保留 |
| D02 | forward schema與隔離重演 | 本輪manifest check42／587 | 未部署 | 584 effective為D19；D17 scoped catalog/history72／56保留；正式schema未處理 |
| D03 | staff／membership／workspace與session gate | scope/race契約；D19 role8歷史 | 未部署 | 正式staff登入成功但membership0是scope限制，不能靠重新登入或移除gate解決 |
| D04 | empty/error/409與輸入恢復；R2五項支援UI | R2新增19 assertions／8 browser；本輪D17品質納入 | 未部署 | 成功scoped讀取／metadata持久化為real local；empty／503 mocks明示 |
| D05 | legacy無效URL與批准證據保護 | 原16＋194；D19 real legacy | 未部署 | 無效URL不能普通批准；沒有新一輪當前core runtime |
| D06 | CRM transaction／revision／idempotency | D19 forced-audit rollback／並發replay保留 | 未部署 | 沒有放寬RPC原子性或去重語義 |
| D07 | 沿用active／proof／reward engine | D19 core9／role8／Edge5 | 未部署 | 歷史角色刷新同pending及15 history；本輪沒有重跑完整交接 |
| D08 | 工作首頁與導航；D17預留載入空間 | D08持久化歷史＋D17 reflow／CLS | 未部署 | 目前selected品質涵蓋Home；未冒作實機驗收 |
| D09 | DTO／分類／資格；D17鎖定卡對比 | 既有契約＋D17 guide a11y | 未部署 | 資格gate不變；無真實裝置／hosted acceptance |
| D10 | 服務端queue分頁／搜尋／返回上下文 | D17 1k/10k歷史；本輪最新100次兩人queue讀取 | 未部署 | 本輪不是1k/10k重測或production load |
| D11 | 香港日期／到期與radar精確導向 | HK日期邊界及原16＋194 | 未部署 | 測試clock/fixture修正不延長正式expiry |
| D12 | 交付要求表單／校驗／預覽 | 106 targeted與6 API／3 browser歷史；current full綠 | 未部署 | unknown keys／reload／409保留；不是重新執行全部作者旅程 |
| D13 | Auth／onboarding／social／Passport | 8 real API／4 Edge歷史；current full綠 | 未部署 | 外部PKCE UI exchange為明示transport mock |
| D14 | 誠實公開承諾／課程preparing狀態 | 6 API／4 Edge歷史＋D17卡片對比 | 未部署 | release owner確認及D15真實教材仍open |
| D15 | versioned units／持久progress；R2 parent表單完成 | N03合成2 units／2 Creators；F27 real409及reload | 未部署 | UC-C18／A51仍BLOCKED四堂核准教材，F27本機表單已非待做 |
| D16 | 既有assistant reserve／claim／save／unknown | 既有mock與owned quota整合歷史 | 未部署 | live前須staff/context durable request覆核；不自動重產unknown |
| D17 | responsive／a11y／CLS與DB port gate | 1954/363 full；5 Edge＋1 performance；12頁axe／48cells | 未部署 | 393最新local notices／481聯集全PENDING；native/device/AT/hosted仍blocked |
| D18 | workspace／platform能力與audited grants | 216 targeted；D19 role8／78 HTTP歷史 | 未部署 | 單workspace PK／零自動升權；正式staff cutover未做 |
| D19 | 完整核心交接與legacy ACL forward修復 | 1867/363歷史；support441＋proof3／role8／core9／Edge5 | 未部署 | R1 verified僅D19 fingerprint；formal pilot／七日觀察未做 |
| D20 | embedded brief coach／review summary離線 | 88 targeted／24 mock子案／6 mock Edge歷史；current full綠 | 未部署 | 真實provider disabled，無真實provider品質／成本／usage驗收 |

R2五項支援UI（UC-C15/C16/C17/A45/A49）與F27 parent Metadata(JSON)表單的本機缺口已由 [R2 delivery](R2-ui-delivery.md) 完成；包含真實save／hard reload／409、legacy plain-string三方合併及unknown keys保留。Empty Academy/global content及503故障的transport mocks有標示，沒有刪既有資料製造空白。舊報告的「較廣UI/F27尚未做」不再當作當前本機待辦，亦沒有把它們升格為hosted驗收。

最新 [D17 delivery](D17-R2-delivery.md) 的頂欄擠壓、長標題、34個鎖定卡對比節點及loading CLS均有RED→最小修正→驗證；新DB port gate亦有3 fail／1 pass→4 pass mocks後的真實唯讀觀察。12頁／48 reflow cells與12頁axe選定規則0violations；最後獨立lab最高LCP 744ms／CLS 0.012834，100次兩位Creator queue p95 59.44ms。這不是1k/10k、INP、實機、field p75或cold/warm性能重驗。

## Case coverage

107 audit cases、28 findings、20 tasks、12 new-product cases齊全；原CSV 1645欄位及originalAuditResult保留，本輪沒有改case/finding/backlog/product CSV。現有newResult的範圍由新matrix逐案標記：

| Recorded newResult group | Count |
| --- | ---: |
| `PASS_FRESH_LOCAL_CONTRACT; prior runtime retained` | 49 |
| `PASS_FRESH_OWNED_CORE_OR_ROLE` | 38 |
| `PASS_FRESH_OWNED_SUPPORT_API_DB` | 9 |
| `PASS_SELECTED_LOCAL_UI; explicit mocks labelled` | 5 |
| `BLOCKED_CONTENT_NOT_PROVIDED; original-4-real-lessons-acceptance-open` | 2 |
| `PASS_SELECTED_LOCAL_QUALITY; named_owner_device_hosted_BLOCKED` | 3 |
| `blocked-production` | 1 |

49／38／9群組保留D19本機契約／owned runtime範圍；5項為R2本機UI，3項為D17本機品質，2項真實內容blocked，1項正式環境綁定blocked。所有`PASS_SELECTED_LOCAL`均不是正式驗收通過。N04–N09共24個D20 mock子案不算真實provider；N11的原result=not-run與後加D18/D19本機newResult並存。

`fixture_contract.json`有先前任務新增Acceptance與newResult，以及先前status更新；原status保留在originalStatus，其他原contract欄位與附件一致。本輪整份fixture contract未改。原194契約中9檔與audit baseline canonical bytes相同；唯一差異仍只是既有HK reviewDueAt fixture由18:00Z改12:00Z，斷言未改，正式evidence expiry未延長。D19/D20舊逐檔skip彙總各54檔的pending-only exporter問題，仍由 [歷史附錄](final-review-test-accounting.json) 和本輪重算表說明，沒有覆寫原JSON/logs。

## 測試與新跑的核對

最新 [D17 gate commands/counts](D17-R2-gate-exits.json)、[逐assertion](D17-R2-suite-results.json)、[browser](D17-R2-browser-final.json) 與 [sequential performance](D17-R2-performance-profile-final-post-gates.json) 均保留。完整suite在RUN_INTEGRATION=0／RUN_AUDIT_INTEGRATION=0及空provider keys的offline範圍執行；363個skip不是PASS，275是實際檔案而非Vitest nested suite數。4個既有lint warnings及route/bundle warnings仍在。

本輪新跑non-mutating `release:manifest:check` exit0，核對348 source／940 prior evidence hashes、345個直接evidence refs（missing0）、1645 immutable CSV欄位、4代suite逐assertion計數，以及10個rollback reverse check-only。沒有執行共享seed/reset、client setup、DB query或新的付費／通知操作。[本輪checks](final-review-D17-checks.json)、[manifest log](logs/final-review-D17-manifest.log)、[rollback log](logs/final-review-D17-rollback.log)。

## Schema、E2E及財務

Manifest42／587 distinct declared capabilities，digest `3e6809f9a51b1ac7ebb9f770160aab27f02523ebf69fc47f8fe38f44d05f6363`。D19完整觀察為584 effective；最新D17 scoped catalog/history72／56與D19的相同查詢一致，並在SQL/CLI之前核對Docker API/DB/network與DB實際port mapping。本輪沒有查庫，不能把上述歷史資料當正式庫現況；無新migration、checksum/history/RLS/grant或membership變更。`brand_users.user_id`單workspace PK保留。

D19歷史E2E：Creator legacy→reviewer批准→active交付／修稿／再交→proof修正驗證→operator完成→Creator/operator/finance刷新同一persisted pending reward及15筆歷史。Creator內部handoff ID刻意null；安全DTO加operator/finance ID及唯一DB row證明持久化，沒有為測試放寬欄位。

Pending／cancel／reapproval測量的funded anchors為XP145、points550、withdrawable125、point/cash/budget ledger各1、budget8875，以及一個inventory item的stock_qty／stock_remaining均3，前後相同。既有legacy approval本來會發500points／135XP／125cash、扣125budget；active join原有+10XP，均先於pending測量。**整段legacy journey不是neutral；pending不等於付款。** R2與D17兩位Creator的raw snapshots亦相等，但沒有funded budget/inventory，不能取代D19 funded證據。以上均為已封存fixture觀察，本輪沒有財務動作或DB讀寫。

## 剩餘 blocker 與下一步

| Blocker | Status | 缺少 | Next step／邊界 |
| --- | --- | --- | --- |
| D15_CONTENT | BLOCKED_CONTENT_NOT_PROVIDED | Four real approved lessons for UC-C18/UC-A51; author/reference/content approval absent | Provide approved repo content/reference, then run author→Creator→persisted progress acceptance; Synthetic units never substitute |
| ADVISOR_OWNER | BLOCKED_NAMED_OWNER_NOT_PROVIDED | Named owner, authority and per-notice decisions/attestation for481 historical/current items | Assign actual human owners and record evidence/decision/acceptedAt for each notice; keep88 not-observed notices open |
| D17_DEVICE_AT | BLOCKED_DEVICE_NATIVE_ZOOM_MANUAL_AT_EVIDENCE | Native200% browser zoom, physical device, Safari/WebKit and manual screen-reader evidence | Use available real devices/native browser/AT and label exact device/browser results; CSS simulation is not a replacement |
| D17_HOSTED_FIELD | BLOCKED_HOSTED_FIELD_EVIDENCE | Authorized hosted advisors and field p75/cold/warm/network/device evidence | Bind authorized hosted project, schema/source/time and capture real evidence; retain local lab limits |
| FORMAL_STAFF | NOT_AUTHORIZED_NOT_RUN | Exact existing staff/workspace scope, named owner, least-role mapping/bootstrap and formal cutover authorization | Retain successful-login/membership0 scope diagnosis; do not relogin or weaken membership; keep user_id single-workspace PK |
| D14_PUBLIC_COPY_OWNER | OWNER_RELEASE_CONFIRMATION_OPEN | Release-owner confirmation of bounded public commitments and enabled course scope | Review truthful copy/disabled unavailable functionality with actual owner; do not imply curriculum or payment capability |
| D20_LIVE_PROVIDER | DISABLED_NOT_RUN | Live staff/context-bound durable request safety review and separately authorized provider quality/cost/token/latency evaluation | Keep provider disabled; review existing D16 reserve/claim/save/unknown scope before any explicitly authorized live trial |
| CURRENT_CORE_RUNTIME | NOT_RENEWED_ON_CURRENT_CANDIDATE | Complete legacy/active/proof/reward role handoff on final current candidate; last full owned run isD19 fingerprint | If continuing toward release, renew selected core runtime on already authorized exact disposable targets after identity preflight; this records review did not rerun it |
| HOSTED_RELEASE_UC_R03 | HELD_NOT_DEPLOYED | Candidate commit/deployment SHA, CI, current target-bound schema/history/protected evidence and named release/rollback owners | Prepare fresh target-bound evidence under required authorization; preserve expiry and formal approval gates; no push/merge/deploy authorized |
| PILOT_OBSERVER | NOT_ENABLED_NOT_RUN | Formal pilot enablement and seven-day observer evidence | Only after release/pilot conditions and explicit authorization; no scheduler or production mutation in this review |
| EXTERNAL_ACTIONS | MOCK_OR_NOT_RUN | Real notifications/invitations/publication, paid AI and payment acceptance | Keep mocks/sandbox and pending reward semantics; do not add financial issuance or external actions |
| AUDIT_ARCHIVE_BYTES | NOT_AVAILABLE_AT_EXACT_PATH | Original audit ZIP at supplied exact Downloads path for a fresh byte hash | Retain expected SHA/imported tests; recheck the exact supplied file when available without broad search or guessing |
| EARLIER_PATCH_LAYERING | DEPENDENCY_HUNK_REVIEW_REQUIRED | Six earlier patches do not mechanically reverse on the layered current worktree; hosted compatible rollback SHA remains unbound | Review dependency/hunk compatibility, preserve fail-closed role/ACL guards and all data/history; no bulk reset/down/reverse |

D17歷史463、D18歷史471、最新D17 R2的393 notices不可當成同一次觀察；481聯集中88項未再觀察仍open。最新393＝297INFO＋96WARN，沒有為消警告加寬policy或刪index。所有具名owner／authority／acceptedAt欄位仍空白PENDING；[checklist](D17-R2-advisor-owner-checklist.csv)及[要求](D17-R2-advisor-owner-acceptance.json)是可review材料，不是人類簽收。

下一項仍 **D17 外部驗收**；D15內容、D18正式staff、D20 live provider為獨立blockers。若往release推進，先在既有授權的exact disposable targets上重綁當前candidate完整core runtime，再依另外所需正式授權處理hosted/production gates；本輪沒有要求或取得發布授權，沒有新增D21。

## Rollback

以下全部只執行`git apply --check --reverse --ignore-space-change`，沒有套用任何patch。

| Source patch | Mechanical result | Exit | Action |
| --- | --- | ---: | --- |
| D12-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D13-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D14-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D15-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D17-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D18-changes.patch | 層疊改動：逐hunk review | 1 | 未套用 |
| D19-changes.patch | check-only通過 | 0 | 未套用 |
| D20-changes.patch | check-only通過 | 0 | 未套用 |
| R2-ui-changes.patch | check-only通過 | 0 | 未套用 |
| D17-R2-changes.patch | check-only通過 | 0 | 未套用 |

四項mechanical pass不表示可部署回退；六項overlap不是新的產品回歸，而是現在不能直接套用舊patch。D01–D11沒有獨立task patch可在此直接核對，須按共用source及before-images作dependency/hunk review。盲目回到D18前server或放寬legacy ACL可能恢復過廣staff權限；保留fail-closed能力／membership／ACL、每份forward migration/history/checksum及所有audit/proof/reward/ledger/fixture rows。沒有down/reset/db push/廣泛delete或remote rollback。Hosted相容SHA與rollback owner仍未綁定。

本輪文件before-images及[變更清單](final-review-D17-changed-files.json)可供逐檔review還原；不要reset整個dirty worktree。任何後續source修復或回退需按影響重跑gates/runtime並重新綁evidence，不得延長正式expiry。canDeploy／canEnablePilot持續false。
