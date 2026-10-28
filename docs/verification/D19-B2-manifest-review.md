# D19 B2 target／fixture／E2E manifest review

**Review 已完成；目前不宜直接批准 runtime B2。** 現有只有 B2 概念上限，並沒有可安全執行的新 target manifest；本輪建立[提案 manifest](D19-B2-manifest.json)及[七項 blocking findings](D19-B2-review-findings.json)。建議先批准 **B2-P0：只做本機接線、journal、evidence、origin 與驗收補缺及離線測試**。P0 與 runtime 本輪都未批准。

| P1 | 問題 | 執行前要完成 |
| --- | --- | --- |
| B2-F01 | 新 target 接線尚未實作 | 延伸現有 target loader／provisioning profile，明確選擇新 manifest；禁止 fallback，先核實 Docker/project/image/network/mount/ports 才讀 keys、建 client 或 setup。保留 B1。只固化經 review 的非秘密 profile，不複用舊 env／volume。 |
| B2-F02 | 舊 fixture 及 evidence 路徑會被重用 | 所有 private/public 產物按本輪 global run／phase 隔離；role→browser 明確依賴已完成的同 target role fixture。舊檔只讀作歷史，不用先覆寫再還原。 |
| B2-F03 | 部分建立與 journal 之間有 crash gap | 先持久化 exact intent／quota reservation，再記成功 IDs；Auth 回應不明時停止新建，僅按已記錄的 exact private correlation 查證；每次成功 parent/child write 記錄，未知結果不釋放 quota。 |
| B2-F04 | HTTP allowlist／browser port 仍綁舊環境 | 以已核實 manifest 派生 exact web/API origins；web server、build env、全部 browser contexts、request fixture、Node preload 一致；禁止泛 localhost 或舊 origins fallback。 |
| B2-F05 | Legacy 發放與 pending neutrality 的範圍需明確 | 逐項列出合成 seed 與兩次既有 legacy issuance 的批准範圍。每個 pending transition 用原始 before/after 向量比較，join XP／legacy issuance 分窗；不扣數字偽造 neutrality。 |
| B2-F06 | Parent caps 未涵蓋完整寫入範圍 | 完成每個 family 的操作／row cap、SQL/RPC allowlist 與 baseline diff。只容許新 target 上一組 exact run-scoped fault function+trigger，條件只命中本輪 creator；不得停用安全 triggers/RLS 或改舊 checksum。未解決 row caps 前不可執行。 |
| B2-F07 | 現有案例未覆蓋全部必要 runtime 驗收 | 在既有 journey 完成前補實際 stale409／network recovery，並以現有 denial workspace 驗空白；core 加一筆有界 historical-invalid legacy fixture 驗 ordinary approve 拒絕及零副作用。不得刪掉原 8/9/5 案例或降低 16/194 語義。 |

逐項 finding JSON 有 exact source path／line／SHA256。這些是 source review 結果，不是今輪 runtime 失敗或實作完成。

## 待批准的 target 提案

Project `adfocate-d19-b2-20261025-b0db3134`、planned owner run `b0db3134-c0c2-483f-abf6-89cb32953ce0`；**只是本機 intent，未建立／查證**。

- 上限：1 project、1 persistent DB volume、1 exclusive network、5 pinned-image containers（DB/Auth/REST/Kong/Storage）。Images 取自已保存的成功 profile；本輪未查 image cache，不 pull／改用 latest。
- 提議 origins：web `http://127.0.0.1:56800`、API `http://127.0.0.1:56821`；DB host port56822。可用性 UNKNOWN；衝突便停，不偷偷換 port 或 target。Proxy none。
- 專用 bridge、masquerading disabled、host binding127.0.0.1；所有實際 IDs、volume creation time、mounts、exclusive members 及 engine 必須重新核實。這不是靠 localhost 名稱證明隔離，也不是實體 firewall 保證。
- 只掛新 DB volume；Storage 暫提 tmpfs256MiB，不得多出 persistent/anonymous volume。P0 須補完 mount spec 與離線漂移測試；實際 image/mount metadata 是獲批建立後、client/setup 前的 gate。Keys 全新生成並留 private，不複用舊 env／volume。
- Bootstrap 先核實 metadata，再啟動這批新服務，再核實實際 target，才進 application SQL／SDK／fixtures。72 個 migration 原 SHA 全列在 manifest；42 個 protected entries 不改。舊 pristine profile 的8 column grants／1 function revoke 只列為待核對的新 target compatibility，不盲目套用。Migration seed baseline 要另列，不能把 fixture-add cap 說成整個 target 的 row total。

## Fixture：核對了甚麼

| Phase | Auth subjects | workspace | mission | workflow | platform roles | workspace roles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| role | 11 | 2 | 1 | 1 | 1 | 7 |
| core | 62 | 2 | 3 | 2 | 1 | 6 |
| browser | 11 | 2 | 2 | 1 | 1 | 6 |
| 合計 | 84 | 6 | 6 | 4 | 3 | 19 |

這些來自歷史 retention 的實數，並與 factory 的2 creators＋9 staff／phase、core51 queue-only subjects 相符；只是一次執行的提案 cap，不是已建立或可無限重試。每 phase 一個 primary、一個 denial workspace；`brand_users.user_id` PK 不變。全新 planned workspace／mission／budget／gift IDs 已列，Auth/RPC 回傳 IDs 仍待成功後 journal，不把 planned IDs 當成功。

另外明列3 funded budgets（各9000）、3 gifts（各stock3）、6 points／earnings baseline rows、1個 unpublished platform resource、core assistant 合成 request／turn、最多4 lifetime handoff rows（最後3 pending＋1 cancelled）。Browser 借用 role editor/resource 必須同 target/global-run/source；不得讀舊固定 private fixture。

為補 persisted-invalid legacy approve 負向驗收，另提最多 **1 筆 core legacy submission**，總 submission 上限7，沒有增加 mission/Auth/workspace/workflow。構造必須符合現有 schema／歷史 fixture 機制、quota 及 constraints；不得 disable trigger/RLS。Child tables、Auth side tables、bootstrap seed inventory 及其 exact caps 尚待 P0 補齊，所以 runtime manifest 仍未 complete，沒有 blanket child-write 批准。

## 財務、DDL 及清理界線

**Pending reward 全程仍禁止 ledger credit、withdrawable 增加及 budget debit。** 原始 before/after 向量按每個 pending transition 比較；既有 join XP 及 legacy issuance 分窗記錄，不扣數字偽造 neutrality。

現有 core／browser 各一次 legacy approval 會發放既有合成 reward。提案須另外明確批准最多2次、每次cash125／points500／budget debit125（總cash及budget各250、points1000），而非稱整輪零財務變更；沒有付款 gateway 或真實轉帳。歷史 submission 的 `xp_awarded=135` 是累積 anchor，**不能冒充 approval XP delta**；P0 要按 pinned contract 分清，未解決前不批准 runtime。

Core 原 atomicity test 會 create/drop 一組 run-scoped fault function＋trigger，只命中本輪 exact creator。這項新 target-only 技術 DDL 與 finally catalog readback 必須列入批准；不得停用既有安全 triggers、RLS、改舊 migration checksum 或影響其他 rows。

預設不刪資料、不自動 stop/remove containers／volume／network；保留 exact IDs 後另行 review cleanup。意外寫入便停依賴工作、保留證據，不猜值還原；phase partial/unknown response 消耗 quota，不以新 namespace 重建一批。

## E2E 與持久化證據

[Acceptance matrix](D19-B2-acceptance-matrix.json)列出原 role8、core9、browser5，另有兩項 browser coverage obligations（在同一 owned journey 完成前補 stale409／network／empty；不虛稱已跑7個 tests）。原案例、16 稽核語義及194契約不可降低。

需要 Creator→reviewer→operator→finance 的 legacy／active／proof／pending reward 全旅程、重試去重、CRM review/note/audit transaction、real409、membership/cross-workspace拒絕，以及刷新後相同 canonical reward／history。Creator `pendingReward.id=null` 是既有隱私契約；以 operator／finance ID＋workflow/submission/creator DB binding 證明同一 row，不能為符合字面要求向 Creator 暴露 private ID。Proof metadata unavailable／access503／network fault 的 mock 均明示；不聲稱真實發布或外部 metadata 驗證。

兩個 pristine global RPC cases 保留，不重跑；不呼叫 close_due_campaigns、snapshot_campaign_leaderboards 或 settle。D15 真實課程、具名 advisor owner／裝置／hosted、正式 staff membership／角色、production／release／7日觀察仍 blocked／未授權。Staff membership=0 仍是 scope 問題。真實 provider disabled，沒有真實通知／邀請／付款／付費AI。

## 可直接選擇的下一步

建議的 **P0 本機-only 批准文字**已放在 manifest `approval.P0Text`：完成上述七項本機準備和離線測試後，以新 source fingerprint／manifest digest 再 review。這次 review 不等同 P0 或 runtime 批准；runtime command 尚未實作，不提供會誤指向舊 target 的執行指令或虛構 CLI flags。

Runtime 批准需待 P0 source／caps／schema profile／legacy financial範圍／origins／lineage 全部定稿及 gates 通過。本輪沒有建立 target、fixture、Auth subjects、SQL/API client，也沒有跑 integration／E2E、重跑舊 full suite、讀取 target secrets、commit／push／merge／deploy。B1 排除、事故 OPEN／未還原、release HOLD 及 provider disabled 全部維持；本輪不稱 R1 verified。

## 交付與完整性

[Review delivery](D19-B2-review-delivery.json)、[變更清單](D19-B2-review-changed-files.json)、[完整性檢查](D19-B2-review-integrity.json)及 `adfocate-delivery.json` 已記錄 code／test／deployment／runtime 四層。Source fingerprint 仍為 `d7cc43ad92ad96b0b7d424a1ce903a42a7e83edc0c57319e8d33ad2d4ed82ac5`（354）；1993/0/363 是已保存 B1 checkpoint，不是本輪新測試。

核對指令：目前 worktree 下 `python docs/verification/D19-B2-review-check-records.py`，只核對本機文件/source/hash/Git 並封存，沒有 target 動作。文件回退可用 `D19-B2-review-prior-*` exact copies；保留新文件時不能直接覆蓋舊 seal，須按實際文件重新計算。沒有執行回退；文件 rollback 不等於資料還原或解除 B1／事故／HOLD。
