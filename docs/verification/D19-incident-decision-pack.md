# D19 三筆隔離 campaign 事故處置決策包

**結論：依今輪檢視嘅既有紀錄，三筆目前都不能可靠、精確還原。** 有可信事前hash／ID紀錄，但沒有帶ID的完整事前row；原 `closed_at`、`updated_at` 仍是 **UNKNOWN**。這不代表所有地方都沒有備份：未查的 backup／audit／PITR 系統仍是UNKNOWN。

**建議先選 A：只批准 Q1–Q3 唯讀追查前像。** 暫不批准 C（精確還原）。B1可另選作保留事故、隔離受污染fixture；它是containment，不是還原，也不會關閉事故或解除HOLD。

今輪只讀現有本機紀錄並寫文件；沒有DB／Docker／API／backup系統查證、SDK/setup、測試重跑、還原、刪除、新建資料或target。已通過的pristine兩個全域RPC驗收完全保留，沒有重跑。事故OPEN、releaseHOLD、真實provider disabled；不commit／push／merge／deploy。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`；candidate `9812cc7755dd6443f8fa4b39bc92e6c26536b54e15ba1c0cbc494815375dd5e1`／353 source records，程式／測試／SQL不變。既有checkpoint的1982pass／363gatedskip、原16＋194、兩global cases等數字是歷史已保存結果，**不是今輪新跑**。

## 三筆逐項事實

共同環境（E01）：local disposable **`adfocate-r1-shaped-20261023`**；workspace `00000000-0000-0000-0000-0000000000aa`；API127.0.0.1:56521／DB56522；DB container `34bd00cda4f4c91650795b83d4d48d5e46ecb90b310a3e409b31c02f99cec176`；API container `c96d960e276cb7c84ae5bf52fdf77e854865516d89d95ca2148a55b6137fa7e9`；network `fbf71b13e7f584b230b293383cccbd2157814168cbae1d9169b377d8f886f69d`。這些是保存的身份；今輪沒有重新查環境狀態。

下表「事前／事後」順序均是 `status / closed_at / updated_at`。**T = 2026-10-24T07:12:04.875188Z = 香港15:12:04.875188。** T是事後欄位直接記錄；把它歸因於該RPC屬有力推論，未記錄實際HTTP request-start／commit。不是用檔案mtime當操作時間。

| Campaign ID（高可信候選，未有keyed前像證實） | created_at（UTC；直接事後投影） | 事前欄位 | 事後欄位 | 證據／限制 |
| --- | --- | --- | --- | --- |
| `937131f9-5417-4ab4-aebd-a5714681f6dd` | `2026-10-23T19:31:11.416523+00:00` | 推論 active／UNKNOWN／UNKNOWN | closed／T／T | E07事後值；E08/E09事前ID；無ID→原值／缺失hash連結 |
| `9e2d04e2-cafb-4ff6-988b-348f0279bba3` | `2026-10-23T19:31:12.02423+00:00` | 推論 active／UNKNOWN／UNKNOWN | closed／T／T | E07事後值；E08/E09事前ID；無ID→原值／缺失hash連結 |
| `d80d80dc-4833-4ab2-9e30-48efaef68d1d` | `2026-10-23T19:31:11.562767+00:00` | 推論 active／UNKNOWN／UNKNOWN | closed／T／T | E07事後值；E08/E09事前ID；無ID→原值／缺失hash連結 |

三筆保存的 `settled_at` 都是null；今輪未查目前值。E11的原函數只對active且到期campaign設定三欄位，沒有settle。E02的當時catalog沒有campaign trigger；這是舊觀察，不保證現在沒有變。三個ID在19:43Oct23的E08已captured／retained；E09只含table/key/ids（3938、3940、3951行），**沒有原status或時間值**。三個candidate關閉時間與E10的campaigns-s2 test-file時間窗一致；但沒有逐row old tuple或可直接把缺失hash配到ID的紀錄，所以仍標candidate，絕不按排列猜配。

**直接集合證據（E02–E06）**：07:03:47.529Z前基線有87 campaign hashes；兩份事前vector完全相同，aggregate SHA256=`6f6e6421b75b87320a4dc82918750ec3914cafe5d1b5c972107d3a3d0addb59d`，與封存E02一致。初輪後缺少三個原MD5：`2c992a43374bebf71fc3e5237348342e`、`32ae750fb714d21fd20f96d7217dbd13`、`d04eb0463aebbcf453f566f8af902682`；08:21:04.754Z保存的原基線比對仍是同三個差異。這證明3個既有完整row hash未保留；單靠hash不能讀回欄位，也不能把每個hash綁定上述ID。07:03:47.529Z是保存的capture clock；原collector分段唯讀查詢，不是完整、transactional、帶ID的row snapshot。

**影響範圍**：已保存證據支持三筆舊campaign狀態／時間受影響的推論；closed可能停止計數並影響grace-window處理。其他原public／auth.users row hashes仍在（包括原財務rows）；這個檢查不覆蓋新增row、Auth sessions/logs／DB stats。E12另外在指定初輪時間窗／既有parent集合查到新增rank snapshot為0。不能據此斷言從未有其他暫態操作／新增資料，亦不能用新pristine的1→0／snapshot1結果冒充舊事故RPC數值或原值。現時dependency／row值／intervening writes仍UNKNOWN。

## 能否精確還原：已檢視甚麼

| 既有來源 | 找到甚麼 | 可否支持原三欄精確還原 |
| --- | --- | --- |
| E02–E04事前catalog／兩份87-hash vector | counts、schema、MD5集合；digest可核對 | **不可以**：無ID→原欄位值 |
| E08／E09及歷史before文件副本 | 3個exact ID、captured／retained；同類副本 | **不可以**：ID所有權不是row before-image |
| E07事後projection／私有同源完整診斷 | 3筆closed／T／T、created／settled觀察 | **不可以**：都是事後，不是原timestamp |
| E10原test report／E11 schema source | 執行窗、assertions passed、函數賦值邏輯 | **不可以**：沒有完整old tuple／舊RPC數值；default或fixture不可替代 |
| 現有本機紀錄搜尋 | 735個root紀錄＋9個archive evidence folders；命中只屬ID紀錄或事後projection副本 | 未找到完整、帶ID、可信事前像；詳細邊界在[evidence review](D19-incident-decision-evidence-review.json) |
| 未匯出的DB/API audit、Docker volume snapshot、外部backup／WAL／PITR | **今輪沒查，UNKNOWN** | 不宣稱不存在；要A明確批准才能新增唯讀查證 |

前像如找到，還要證明它屬同一target／volume lineage、早於T、三個ID齊備、沒有不明中間版本，並以原row-hash serialization建立ID→原完整row→三個缺失MD5的一對一關係。沒有這條鏈，不能把active／null／created_at填回當還原。


## 證據索引（原檔不改）

| Key | 來源 | Selector／用途 |
| --- | --- | --- |
| E01 | [D19-support-current-identity.json](D19-support-current-identity.json) | `/targets/shaped`；Captured disposable target identity; not live-verified this turn |
| E02 | [D19-support-current-schema-before.json](D19-support-current-schema-before.json) | `/targets/shaped/rows/campaigns`；Before87 campaign hashes aggregate; schema and counts, no keyed original row values |
| E03 | [D19-support-current-shaped-rowhashes-before.private.json](../../.codex-tmp/D19-support-current-shaped-rowhashes-before.private.json) | `/campaigns`；Private87 MD5 vector anchored to sealed E02; no IDs/column values exported |
| E04 | [D19-current-shaped-rowhashes-before.private.json](../../.codex-tmp/D19-current-shaped-rowhashes-before.private.json) | `/campaigns`；Earlier identical87-hash vector; still no row-ID mapping |
| E05 | [D19-support-current-schema-after-1.json](D19-support-current-schema-after-1.json) | `/targets/shaped/preservation`；Exactly3 baseline campaign hashes absent after initial support; changed-or-removed detector |
| E06 | [D19-support-current-schema-after-4.json](D19-support-current-schema-after-4.json) | `/targets/shaped/preservation`；The same original3 hash differences remain at08:21; does not clear incident |
| E07 | [D19-support-current-incident-campaigns.json](D19-support-current-incident-campaigns.json) | `/affectedCandidatesByClosureWindow`；Direct after-value projection for3 IDs, labelled candidates by source; capture clock of this projection not explicitly recorded |
| E08 | [D19-fixture-retention.json](D19-fixture-retention.json) | `/support/27`；Prior fixture ownership/retention at19:43Oct23; exact3 IDs retained, no original field values |
| E09 | [D19-support-owned-ids.jsonl](D19-support-owned-ids.jsonl) | `lines3938,3940,3951`；Exact successful campaign ID capture only: table/key/ids, no values |
| E10 | [D19-support-current-c1133f56-3d5c-4417-8aa9-133f1dcaab03-support.private.json](../../.codex-tmp/D19-support-current-c1133f56-3d5c-4417-8aa9-133f1dcaab03-support.private.json) | `/testResults/campaigns-s2.test.ts`；Initial test-file clock and passing global-job assertions; actual RPC numeric results not logged |
| E11 | [0026_campaigns_s2.sql](../../supabase/migrations/0026_campaigns_s2.sql) | `lines23-36`；close_due_campaigns writes status/closed_at/updated_at, filters active and due, no settle call; source review only |
| E12 | [D19-support-current-snapshot-extent.json](D19-support-current-snapshot-extent.json) | `/insertedRowCount`；Saved exact-time query found0 new snapshot children on pre-existing parents; bounded separate insertion evidence |
| E13 | [D19-support-current-preservation-incident.json](D19-support-current-preservation-incident.json) | `/`；Original incident record OPEN/unrestored; no raw before image |
| E14 | [D19-pristine-rpc-integrity.json](D19-pristine-rpc-integrity.json) | `/`；Two global cases passed on other pristine data; not old-row restoration evidence |
| E15 | [D19-current-browser-results.json](D19-current-browser-results.json) | `/`；Prior browser evidence atcdf fingerprint; no fresh browser run in this decision-only task |
| E16 | [D17-R2-advisor-owner-acceptance.json](D17-R2-advisor-owner-acceptance.json) | `/`；Named advisor owner and hosted acceptance still missing |

每個來源的SHA256／bytes見evidence-review JSON；private hash vector只輸出必要的count／aggregate／三個缺失hash，沒有輸出其他row或個人資料。

## 你可直接選擇的選項

| 選項 | 目前是否可選 | 影響／動作範圍 | 驗證／要批准的決定 |
| --- | --- | --- | --- |
| **A（建議）：先找可靠前像，只唯讀** | 可單獨批准；尚未批准 | 只Q1–Q3；**0寫入、0刪除、0新建**。查不到就報unavailable／UNKNOWN，不自動轉B/C | 同意限定target／3IDs／舊時間窗的身份、既有backup/audit來源及當前dependency查證；不授權修復 |
| **B1：保留事故，隔離舊fixture** | 可另選；尚未批准 | 本機acceptance target denylist／文件，把整個舊shaped project當forensics-only，避免未明依賴漏網；不改row、不刪、不stop容器 | 需先test再最小調整target guard，證明SDK/setup前拒絕舊target。結果是**CONTAINED_NOT_RESTORED／事故OPEN**；不解除HOLD |
| **B2：另建乾淨role/E2E資料** | 不能由B1自動授權；要另批manifest | 1新project／1新volume／最多5固定image容器；使用既有3phase factories，最大84新synthetic Auth、6workspace（每phase一主要＋一scope拒絕反例）、6missions／4workflows、3platform＋19workspace role rows；child writes只限這些owned parents，成功建立即journal exact IDs。**不重用／reset pristine驗收target** | 提供identity／fixture manifest後才setup，超出界限另批；驗R1角色／browser及neutrality。原污染保留、原事故仍OPEN，不能稱已還原 |
| **C：只還原有證據的3筆** | **現在不具備批准條件** | 找到可信原值後，另交exact3-ID／3欄值manifest及current fingerprints；一transaction compare-and-swap，僅status/closed_at/updated_at | 三筆full-row hash精確吻合原基線，其他原rows／財務不變；衝突則rollback。不得猜null、重跑close/settle、關guard或改舊migration。還原驗證、事故關閉、release放行仍是不同決定 |
| D：暫不新增查證／處置 | 可選 | 0資料動作；UNKNOWN與OPEN/HOLD保留 | 不當作接受偏差、不算事故解決或R1 verified |

B1只屬驗收用途隔離，沒有聲稱網絡已隔離或容器已停止；物理cold containment另批。

B2上限來自已保存role/core/browser三輪retention（Auth11＋62＋11；每輪2workspace、missions1＋3＋2、workflows1＋2＋1），不是今輪建立或授權的資料。所有未列child family／cap變更必須先在manifest列明；不改brand_users.user_id單workspace主鍵，不碰正式staff。

## A的最小新增唯讀批准清單（今輪均未執行）

1. **Q1：先身份及歷史來源inventory。** 只舊shaped target的exact container/project/network/volume mapping；再看它的既有backup/snapshot/archive/audit metadata。只輸出來源ID／lineage、時間窗、digest及是否有完整old row。三筆齊備的來源應在2026-10-23T19:31:12.024230Z之後、T之前，優先對應07:03:47.529Z基線。不掃無關磁碟／project，不建立backup、不啟用logging/CDC、不start／stop／restart daemon或容器；身份／可讀路徑不可用便保留UNKNOWN。
2. **Q2：有可信來源才讀3筆事前像。** 僅三個ID，完整row只用來做原hash serialization／mapping；交付只顯示三欄原值與digest。statement-only log不足。若必須新建recovery clone才讀到資料，**停在metadata報告，另交精確新建範圍求批准**，不能把它藏在「唯讀」內。
3. **Q3：當前狀態及dependencies。** 身份gate通過後，在read-only transaction讀三筆current fingerprint／三欄、相關column/trigger/constraint及FK child aggregate counts。不得讀無關Creator/Auth內容，不做login/admin動作或business RPC。沒有身份／權限／可讀前像就保留UNKNOWN。

憑證只留本機，不輸出token、password或連線字串；row原文只供必要hash比對，交付不含無關作者內容／Creator個人資料。

可直接回覆：

> 批准 A：只限本包 Q1–Q3 唯讀查證；不得還原、刪除、新建、重跑驗收或關閉事故。

或：

> 批准 B1：舊 shaped target 只保留鑑證用途、禁止後續驗收重用；不還原、不刪除、不停止容器、不關閉事故。B2 新 target／資料／E2E 仍另批。

**目前ownerSelection=null／未批准任何選項。** 今次準備決策包的要求不是上述任何操作的批准；也沒有「全部還原／關閉事故」選項。

## 之後通往R1 verified：剩餘驗收與依賴

完整機器清單在[D19-incident-decision-r1-checklist.json](D19-incident-decision-r1-checklist.json)。

| Gate | 現有證據／狀態 | 還需要甚麼／完成條件 |
| --- | --- | --- |
| 事故處置及可信target | 本包decision-ready；沒有原timestamp前像 | 明確選項批准、bounded impact／處置驗證；保留原failed基線。非還原方案另有scope接受決定，不能改寫成已還原 |
| Source／schema／fixtures | source353與HEAD保留；新global target已留存 | 後續role/E2E target需獲准、身份先於SDK，完整object/RPC/grants/RLS/history diff、exact run-ID／before baseline；原checksum不改 |
| 原16＋194、full／static／必要integration | 最新checkpoint1982／363／277、static綠；今輪不跑 | unchanged source可保留有界證據；改動後按影響重跑。必要live reward/proof integrations不可skip／用mock代過；原439＋proof3是各自時間/source的歷史結果 |
| Role/API/core | 之前role8＋core9在cdf fingerprint通過 | 核准可信target上的current-source完整交接；membership=0／cross-workspace拒絕、角色能力分離、legacy invalid URL不可普通批准、CRM review/note/audit原子性／revision／idempotency、未知歷史reward promise阻擋 |
| Browser角色旅程 | 之前local Edge5在05:13–05:14Z通過；不是今輪／新clean353target的重跑 | ①Creator legacy→active交付／修稿／proof→operator完成的完整pending歷史；②finance只讀reload；③reviewer403保留輸入；④platform editor無workspace恢復；⑤Creator/operator/finance硬刷新同一pending ID及歷史。真實Auth/API/RLS/DB；409／過期／錯誤／空白可恢復，mock明標 |
| Funded neutrality | 舊core/browser raw snapshots保留；新global3calls只覆蓋global jobs | 有資金／非null baseline的完整submit/review/proof/complete/cancel/reapproval/reload；ledger、可提現額、budget無delta，issued legacy anchor不重發、one pending及append-only歷史一致。新global證據不可代替完整pending旅程 |
| Global兩RPC | **已通過；今輪明確不重跑** | 保留pristine原2pass／3filtered及close1→0／snapshot1、10financial tables＋XP snapshots；不拿來還原舊3筆、不拼成新441-suite PASS |
| R1裁定／交付 | 當前**NOT R1 verified，HOLD** | 上述必要gates、處置決定與source/target/time/expiry證據完備；原107audit結果不覆寫。READY／toast／PR不能代saved state |

獨立blockers不因將來某個R1內部scope通過而自動解除：

- **D15**：UC-C18／UC-A51仍要4堂真實核准內容及approval reference；不能用synthetic/draft代替。
- **D17 named advisor owner／裝置／hosted**：481歷史union（393當時local observed／88未再出現但仍open）的具名owner／authority／逐項decision/time/ref；native zoom、physical device、Safari/WebKit、manual AT、適用field/workload/outcome evidence與獲准hosted證據尚缺。Local axe/CSS reflow/lab/100reads不代替。
- **正式staff**：成功登入但active membership=0是scope限制。正式exact人員／workspace／role grant或cutover必須另批；不能移除membership gate或把synthetic role UAT當正式銜接。brand_users.user_id PK不改。
- **Hosted／production／pilot**：必須另有實際權限、相符版本及未過期foundation證據，按[release foundation](../operations/production-release-foundation.md)的分開gates處理。今輪沒有live preflight、部署、pilot／7日觀察。正式evidence expiry不延長／刪除。
- **真實provider disabled**；不授權付費AI、真訊息／邀請、發布、付款。這些不是為了補一個PASS而要開啟的測試依賴。

## 本輪交付及可逆範圍

[Machine decision](D19-incident-decision-pack.json)包含逐筆DIRECT／INFERRED／UNKNOWN、操作上限、owner具體決定；[evidence review](D19-incident-decision-evidence-review.json)列來源SHA256／selectors及搜尋邊界。只更新delivery指標及task ledger，case coverage／originalAuditResult及pristine全部證據不變。沒有程式／migration／角色／資料改動，也沒有新增runtime成功宣稱。

文件before-images已封存；如要退回本輪文件，只用exact文件副本，不做任何DB rollback。原事故證據不覆寫；決策包不構成還原、刪除、重建、關閉事故或解除HOLD的批准。
