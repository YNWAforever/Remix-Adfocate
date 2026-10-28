# D19 當前 candidate 核心重驗

當前 candidate 的 **完整 legacy／active／proof／pending reward 角色旅程與財務 neutrality 已在本機隔離 targets 重驗通過**。正式發布與pilot仍 **HOLD／未部署**。本輪沒有應用程式、測試、SQL或設定source修復，沒有commit、push、merge或deploy，沒有正式資料／membership／角色改動，真實provider維持disabled。

此結論限下列實際觀察。Broader support441＋proof preflight3保留為D19歷史，沒有重跑；不把selected core重驗稱為整份當前R1的全案例驗收。

入口：[機讀結果](D19-current-delivery.json)、[adfocate-delivery.json](adfocate-delivery.json)、[逐案scope](D19-current-case-coverage.json)、[integrity](D19-current-integrity.json)、[changed files](D19-current-changed-files.json)。上一份[D01–D20總覆核](D01-D20-final-delivery-review-with-D17-R2.md)保留為歷史；其CURRENT_CORE_RUNTIME缺口已由本輪指定旅程解決。

## 版本、身份與schema

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`，沒有reset。Source fingerprint `cdf8597d00d4cf716823a420296cb0e40ba1fa13e0fa11ca7feb735f8f04c996`／348 canonical-LF records，測試前後相同。原955份證據在更新交付文件前全數hash吻合；原D19文件、logs、runtime及private session pointers均保留原bytes。本輪輸出另存於`D19-current-*`及`D19-current-runtime/`。

[身份gate](D19-current-identity.json)在client／fixture／SQL之前比對實際container／image／project／network及owner label。Empty API／DB為127.0.0.1:56421／56422；shaped為56521／56522，沒有proxy或hosted target。兩者均與原授權ID一致；後續每個既有fixture factory亦重新驗證Docker身份。

先唯讀比較objects／RPC definitions／grants／RLS／constraints／indexes／triggers／history，再開始fixture。Manifest42、587 declared，兩target均584／584 effective。History empty72／shaped56；完整before／after catalog及既有public base rows與auth.users row hashes吻合。沒有新migration、history/checksum修改或正式schema查詢。既有CRM fault測試短暫建立及移除本輪唯一ID的trigger/function，最終catalog不變。[Schema diff](D19-current-schema-diff.json)保留比較範圍，Auth sessions/logs及DB statistics不在row preservation宣稱內。

## 四層結果及測試

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 既有引擎／測試先跑；無產品source修改 | fresh1954 pass／363 gated skip／0fail／275 files；原16＋194；role8＋core9＋Edge5 | 未部署 | 同source完整指定旅程、funded pending neutrality、15 events、1 durable pending |

- [Role API](D19-current-role-results.json)：8 pass／0skip，78 HTTP觀察，明確membership／能力／workspace gate、禁止自升權及即時撤權；正式staff成功登入但membership0的scope問題不變。
- [Core API](D19-current-core-results.json)：9 pass／0skip，quota race、收貨／草稿、409、重試去重、修稿／proof、取消／再批准、缺歷史contract拒絕、CRM audit故障transaction rollback、51筆分頁及合成assistant turn；沒有付費provider。
- [Edge](D19-current-runtime/browser/D19-browser-summary.json)：5 pass／0skip。真實Creator登入，legacy無效輸入保留／合法交付／reviewer批准；active草稿reload、修稿、proof修正及驗證；operator完成後Creator／operator／finance刷新同一pending／可見欄位及15筆歷史，Creator內部ID仍隱藏，DB唯一pending row讀回為1。
- [完整suite](D19-current-full-results.json)：單worker、RUN_INTEGRATION=0／RUN_AUDIT_INTEGRATION=0、DB／provider env清空。363為gated skips，並非pass；原audit7檔16及protected10檔194逐檔重算通過。275為實際檔案，不用nested suite數。原測試assertions及正式evidence expiry未更動。
- [Manifest check](D19-current-manifest-results.json)及freshbrowser production-assets build通過；既有type／lint／native-ESM build等D17同source gates保留，4個原有lint warnings及route/bundle warnings沒有消失。

實際commands、env範圍、逐assertion、exit及脫敏logs由上述JSON引用。先做identity／schema baseline及capabilities，再跑role→core→browser；browser後啟動full offline，期間只作catalog／neutrality唯讀核對，最後manifest及final seal。本輪無產品RED／修復；preflight首次唯讀hash輸出超過共用helper1MiB buffer，私有inspection改為262144-character分段讀取後成功，[失敗及修正紀錄](D19-current-preflight-attempts.json)保留，不改共用helper或DB。

## 財務 neutrality 與fixture

[Funded raw before／after](D19-current-browser-neutrality.json)：XP145、points550、withdrawable125、budget8875，point／cash／budget ledger各1，redemptions0，一個inventory item的stock_qty及stock_remaining均3；全部相同。Pending完成與刷新沒有增加ledger、可提現額或扣預算／庫存，也沒有支付功能。

既有legacy批准本來發500points／135XP／125cash，enforced預算由9000扣125；active加入原有+10XP。這些持久化變更均先於pending量度，沒有重設餘額或XP來製造相同；**整段legacy旅程不是neutral**。另有[API raw取消／再批准及role snapshots](D19-current-api-neutrality.json)前後相等並保留原legacy錨點。

[Retention](D19-current-fixture-retention.json)：本輪3個新UUID fixture runs／84個Auth IDs全部保留，只有新隔離合成staff的能力與membership被建立／測試，沒有cleanup、seed/reset或舊ID刪除。Shaped只做本輪metadata／catalog／ACL讀取。舊support runner會帶入歷史seed/owned-ID範圍，本輪沒有照跑或把它視為本輪cleanup授權。所有原955證據及既有public/Auth user rows在交付更新前確認未改。

Proof外部metadata為mock-unavailable／HTTP封鎖；503 access recovery是明示transport mock。瀏覽器為installed desktop Edge及emulated Creator viewport，並非實機／Safari／native zoom／manual AT驗收。通知只涉及隔離DB rows；沒有真正訊息、邀請、發布、付款或付費AI。

## Case coverage、blocker及下一步

20 tasks／107 audit cases／28 findings／12 product cases保留；附件原1645個CSV欄位及originalAuditResult均不變。Canonical audit/finding/product CSV與fixture contract本輪未改；只更新backlog D19的newResult四層及交付入口。[本輪matrix](D19-current-case-coverage.json)為16項選定case列具體fresh witnesses及未覆蓋部分，並非107個完整UI PASS；其他runtime按原source/scope保留。

D15 UC-C18／A51四堂真實核准內容、D17具名advisor owner／裝置／hosted及正式staff銜接全部保持blocked。481 advisor聯集／393最後本機觀察仍屬D17歷史，沒有重新跑advisor或人類簽收；真實provider disabled。

| Blocker／未重驗範圍 | Status | 缺少 |
| --- | --- | --- |
| D15_CONTENT | BLOCKED_CONTENT_NOT_PROVIDED | Four real approved lessons for UC-C18/UC-A51; author/reference/content approval absent |
| ADVISOR_OWNER | BLOCKED_NAMED_OWNER_NOT_PROVIDED | Named owner, authority and per-notice decisions/attestation for481 historical/current items |
| D17_DEVICE_AT | BLOCKED_DEVICE_NATIVE_ZOOM_MANUAL_AT_EVIDENCE | Native200% browser zoom, physical device, Safari/WebKit and manual screen-reader evidence |
| D17_HOSTED_FIELD | BLOCKED_HOSTED_FIELD_EVIDENCE | Authorized hosted advisors and field p75/cold/warm/network/device evidence |
| FORMAL_STAFF | NOT_AUTHORIZED_NOT_RUN | Exact existing staff/workspace scope, named owner, least-role mapping/bootstrap and formal cutover authorization |
| D14_PUBLIC_COPY_OWNER | OWNER_RELEASE_CONFIRMATION_OPEN | Release-owner confirmation of bounded public commitments and enabled course scope |
| D20_LIVE_PROVIDER | DISABLED_NOT_RUN | Live staff/context-bound durable request safety review and separately authorized provider quality/cost/token/latency evaluation |
| HOSTED_RELEASE_UC_R03 | HELD_NOT_DEPLOYED | Candidate commit/deployment SHA, CI, current target-bound schema/history/protected evidence and named release/rollback owners |
| PILOT_OBSERVER | NOT_ENABLED_NOT_RUN | Formal pilot enablement and seven-day observer evidence |
| EXTERNAL_ACTIONS | MOCK_OR_NOT_RUN | Real notifications/invitations/publication, paid AI and payment acceptance |
| AUDIT_ARCHIVE_BYTES | NOT_AVAILABLE_AT_EXACT_PATH | Original audit ZIP at supplied exact Downloads path for a fresh byte hash |
| EARLIER_PATCH_LAYERING | DEPENDENCY_HUNK_REVIEW_REQUIRED | Six earlier patches do not mechanically reverse on the layered current worktree; hosted compatible rollback SHA remains unbound |
| SUPPORT_RUNTIME_NOT_RENEWED_CURRENT | HISTORICAL_RETAINED_NOT_RERUN | Broader shaped support441+proof3, full ancillary acceptance and1k/10k/manual/device/hosted scenarios are not renewed by this selected core run |

下一項仍D17具名owner／裝置／hosted驗收；D15教材及正式staff需各自實際材料／授權。若另做broader R1/support renewal，先準備本輪fresh exact-ID fixture，不使用舊seed/delete範圍。正式release／pilot、protected evidence／expiry、owner、CI及相容rollback SHA gates維持；本輪沒有要求或取得發布授權。

## Rollback

本輪source改動0，沒有新產品reverse patch或schema down。可按before-images與changed-files逐檔review還原交付文件，保留本輪證據及全部dirty work；不要reset worktree。先前10個patch的4個mechanical reverse pass／6個hunk review限制仍適用，source未變，沒有把check-only當rollback執行。正式rollback owner／相容SHA仍未綁定。

84個本輪Auth IDs及相關資料保留供review；未執行清理。任何往後cleanup只可使用本輪exact IDs並保留immutable audit/proof/reward/ledger及forward migration/history。不要盲目db push/reset、篡改checksum、放寬membership/能力或還原過廣legacy ACL。canDeploy／canEnablePilot均false。
