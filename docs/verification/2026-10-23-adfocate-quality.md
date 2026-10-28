# D17 本機品質與產品結果量度

D18 更正（保留原證據）：本報告下方「兩位Creator原始XP0」是文字誤寫。`D17-neutrality-final.json` 的真實before／after均為XP **10／0**；既有join已先給首位Creator10XP，其餘值及前後neutrality結論不變。此處不修改原始snapshots或D17交付JSON。join source見 `D18-existing-join-contract.json`。

D17 已交付本輪選定的 local／disposable 範圍；未部署。D15 **BLOCKED_CONTENT_NOT_PROVIDED** 原樣保留，UC-C18／UC-A51 仍要求原四堂真實核准課程，沒有改作通過。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`。執行介面核實 `gpt-6.1-sol`，沒有切換。沒有 commit、push、merge 或 deploy，既有 dirty 工作保留。本輪 29 個 code/test/script/config 差異；candidate fingerprint `b629920a16a2e513b6bbb2d9f0a575a6539e530ba9ec4b4bdd4557a500a4a953`。

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 延伸既有 Insights、metrics、事件；量測後拆 vendor、修 responsive／a11y | 141 targeted; 1773 full pass / 355 skip; 16 audit +194 contracts; 5 API +5 Edge | 未部署 | 1k/10k totals、300 API reads、24 UI、5頁axe、財務原始快照一致 |

## 實作與正確性

Insights 使用完整香港曆日 `[from,to)`，`to` 是當日香港午夜，不含未完結當日；前期等長。歷史 throughput 與同批次轉換分母分開，排除 cancelled/withdrawn/abandoned，舊批次的本期批准不會令轉換超過100%。依 stable ID 分頁讀完 Data API capped rows；超出安全範圍或讀失敗會503並可重試，不回部分正確資料。沿用 staff＋authorizedWorkspace membership gate，沒有把 staff 登入當作 workspace 權限。真實 API：staff無membership403 `WORKSPACE_MEMBERSHIP_REQUIRED`、foreign workspace404、Creator403、anonymous401。

積分統計由已入帳 `point_transactions` 計算，earn25＋adjust−8＝17，redeem−4不列為發放；現金 earn125−adjust12.5＝HKD112.50，標示為淨入帳，沒有稱為已付款。這5筆是本輪明示合成歷史fixture，先建立才取neutrality baseline，沒有真實付款或新增產品支付功能。[持久化API](D17-api-contract.json)、[已知邊界／分母測試](logs/D17-targeted-final.log)。

`activeMission/metrics.ts` 以保存的版本／審核決定量度首次有效交稿時間、首次審稿接受率、交稿後修稿輪數及必要交付逾期率；operator時長需要保存的start＋decision。0樣本與缺少來源分開；未有durable support-request來源時「狀態不明求助」顯示未量度。原有analytics sink仍是optional，沒有聲稱部署collector。新 `product_action_result` 只准 opaque entity ID/action/revision/result；draft success只從識別同一work item的正整數saved version派生，render、pending、空200或version0都不算完成，body/email/URL不入事件。其他原事件、workflow/proof/reward引擎不變。

本輪active workflow今天加入，完整曆日報表合理地沒有其歷史outcome樣本；非零公式以已知資料單測驗證，沒有捏造內部pilot成效或operator效率數字。這是現有觀測來源的限制，後續pilot需要保存真實、獲准的事件／決定才有有效baseline。

## 可存取性與可恢復 UI

Creator `/home`、`/my`、`/wallet` 與 operator `/admin/creators`、`/admin/insights` 共15個360/390/768px cells無document水平溢出，另兩個desktop200%等效reflow cells。**200%是1280×900 physical→640×450 CSS／DPR2模擬，非原生browser zoom。** 核對長姓名／URL、Assistant關閉44×44、Tab／Shift+Tab循環、Escape及trigger回焦點。明示Assistant503 mock只攔截一次，保留輸入並宣讀錯誤，沒有請求付費AI；Insights503 mock後可Retry並由真實API讀回。手機operator header會wrap，controls較易點按；error背景對比修正。沒有更換原有focus engine。

axe 4.12.1 對上述五頁的WCAG2A/2AA/2.1AA選定規則為0 violations。這不是全產品可存取性認證，沒有實機、Safari/WebKit、真實screen reader或native zoom驗收。Desktop畫面另作視覺檢查；包含合成帳戶email的screenshot只留private，不納入public evidence。[Responsive](D17-responsive.json)、[dialog](D17-dialog.json)、[axe](D17-accessibility-scans.json)、[重試](D17-insights-ui.json)、[5項Edge摘要](D17-browser-final.json)。

## 效能：原始樣本與限制

| 測量 | n | p50 ms | p95 ms |
| --- | ---: | ---: | ---: |
| 1,000人queue：Hono＋真實Auth/PostgREST/DB | 100 | 63.90 | 86.54 |
| 10,000人queue：同上 | 100 | 148.16 | 238.05 |
| 最終10,000人：完整loopback HTTP | 100 | 115.86 | 163.86 |
| UI前往24個新分頁，直到API及畫面ready | 24 | 170.60 | 231.89 |

每項API均total正確、25rows；1000及10000各有outer RPC `EXPLAIN ANALYZE BUFFERS`，不把outer function plan當nested SQL/index證明。Queue backend三份檔案hash與D15相同，因此較早scale樣本以該scope綁定；final HTTP/UI在本輪最後app source量測。沒有只為advisor或猜測瓶頸加index。

最後本機兩頁LCP：/admin/creators 520 ms, /admin/insights 504 ms。24個EventTiming interaction IDs的lab INP候選值 32 ms；queue CLS最大session 0.003327。建議本機LCP2500ms、INP200ms、CLS0.1、API p95800ms均在範圍內。UI「至network＋DOM ready」與INP「interaction至next paint」不同，分別保留，不混用。INP不是實際用戶field p75，也不是24次ready時間的p95。

環境：Windows／installed Edge 155.0.4283.62，desktop1280×900、loopback、沒有CPU/network throttling。外部font請求被攔截，使用fallback；Playwright request routing令HTTP cache disabled，DB/server warm、沒有reset。1k/10k較早樣本並非CPU獨佔，曾與一次interim typecheck重疊；raw全部保留，不刪outlier。沒有cold/warm browser比較、實機網絡或production速度聲稱。[原始100＋100樣本／plan](D17-api-performance.json)、[100HTTP＋24UI／EventTiming](D17-runtime-performance.json)、[scope hashes及環境](D17-performance-summary.json)。INP方法參考 [web.dev](https://web.dev/articles/inp)。

先分析入口內React/Supabase/TanStack貢獻，再建立三個vendor partitions。以**同一最後candidate**切換manualChunks測written files：unsplit entry 955968 bytes／gzip 263888，partitioned entry 433831／gzip 111462；但所有initial dependencies合計gzip **263888→265444 bytes，略增**。只稱入口較小及vendor快取邊界，沒有宣稱total transfer／cold start改善。早期generateBundle-stage數字與development NODE_ENV產物不作最終傳輸基準。沒有framework升級。[Bundle比較](D17-performance-summary.json)、[unsplit](D17-bundle-unsplit.json)、[partitioned](D17-bundle-after.json)。

重現環境與量測的額外commands見 [performance summary](D17-performance-summary.json) 的 `commands`。Setup會拒絕既有fixture；10k已存在時scale script會跳過1k並寫新的單階段結果，**不要盲目重跑覆寫本輪樣本**。另一輪兩階段benchmark需要新獲准run／output path；不可刪9k actors製造1k baseline。

## Schema、advisors及neutrality

沒有D17 SQL／migration／grant／RLS／membership變動。Manifest仍40份entries、501個distinct capabilities，digest `e9e801ff06c0c5382ec18e06ca0d9f05dc7a3d8a4ab1b68633e7f7bc5f14ca75`。同一查詢的Academy objects/RPC/grants/RLS、history及brand PK前後相同；empty70、shaped54，`brand_users PRIMARY KEY(user_id)`保留。這是明列範圍的local diff，非全production schema驗收。[Diff](D17-schema-diff.json)、[catalog](D17-schema-after.json)。

本機Supabase CLI read-only advisors：empty223（175 INFO／48 WARN）、shaped240（192 INFO／48 WARN）。全463項有owner角色、risk、處置及validation；**尚未具名owner確認、沒有hosted acceptance**。95項unindexed FK各目標、unused67/85、initplan43各、no-policy13/12、multiple policies2各、mutable functions2各、public vector1各。No-policy表保留default deny：empty client grants false；shaped部分保留歷史grants，但anon/authenticated均無BYPASSRLS，RLS啟用且無policy。兩個mutable functions都是SECURITY INVOKER，未擅自pin path或移extension。沒有用寬鬆policy消warning、沒有根據local stats刪index。後續owner需以forward修復、個別query plan及role等價測試評估。[全部notice與處置](D17-advisor-review.json)、[逐項CSV](D17-advisor-dispositions.csv)、[實際grants／role／function](D17-advisor-catalog.json)。

量測前兩位Creator原始XP0，points50／63，withdrawable0／112.5，point ledger0／3、cash ledger0／2；budget原null、budget ledger0、redemptions0、inventory空。API及browser後所有值完全一致。D17沒有新增pending reward、ledger或可提現額，也沒有扣預算。既有pending reward≠付款契約與16／194測試保留。[Raw neutrality](D17-neutrality-final.json)、[API raw](D17-api-contract.json)。4個base Auth actors＋9998個scale Auth/profile IDs、2workspaces、1mission、1workflow、2workitems及5ledger fixtures均保留exact IDs，沒有cleanup/reset。[Retention](D17-fixture-retention.json)。

## 驗證、歷史與交付

先有metrics5項RED、route2項RED、saved-outcome1項RED、兩個邊界RED及browser3項RED，再作最小修正。真實瀏覽器另找到composite FK ambiguity、header overflow及錯誤底色對比；cached上一頁不發新request的harness等待已改作24個新分頁。錯cwd／offline cache、既有API envelope/window/privacy404等harness錯誤另分類，沒有冒作產品RED。[測試歷史](D17-test-history.json)。

最終type-check、lint（0error／4個既有warnings）、manifest、Node22 build／ESM、27檔141 targeted及260檔full suite通過：**1773 pass／355 skip／0 fail**；原16稽核及194契約均綠、原檔不改。必要D17 integration為5真實read/role cases；5項Edge重新驗證最後source。Broad integration含共享seed／delete，沒有執行或標為PASS。每條commands/counts/logs見 [D17-delivery.json](D17-delivery.json)。4個舊hook warnings與route test discovery warning有保留處置；此輪不作無關重構。最後runtime/pre-suite/post-suite source checkpoint一致。

原107 cases／28 findings／CSV原欄位及originalAuditResult不覆寫，D08/D09/D12/D13/D14/D15紀錄deep-equal。D15正式內容blocker、F27 parent Metadata(JSON)限制原樣。Earlier完整legacy/active/proof/reward handoff只保留原fingerprint歷史證據，這輪沒有重新稱R1 verified或D19可發布。canDeploy／canEnablePilot仍false，expiry未延長；沒有正式庫、CI、部署、真實邀請訊息、付款或付費AI。

## Changed files與rollback

[本輪獨立patch](D17-changes.patch)、[完整inventory](changed-files.json)、[prior checkpoint](D17-prior-code-fingerprint.json)、[交付JSON](adfocate-delivery.json)。

- `e2e/accessibility.spec.ts`
- `playwright.quality.config.ts`
- `scripts/audit/build-quality.ts`
- `scripts/audit/measure-quality.ts`
- `scripts/audit/prepare-quality.ts`
- `scripts/audit/run-integration.mjs`
- `scripts/audit/run-quality.mjs`
- `scripts/audit/serve-quality.ts`
- `server/lib/activeMission/metrics.ts`
- `server/lib/insights-quality.test.ts`
- `server/lib/insights.test.ts`
- `server/lib/insights.ts`
- `server/routes/adminInsights.ts`
- `server/test/audit-quality.test.ts`
- `server/test/insights-window-contract.test.ts`
- `src/components/RequestFeedback.tsx`
- `src/components/admin/AdminTopBar.tsx`
- `src/components/admin/WorkspaceSwitcher.tsx`
- `src/components/assistant/AssistantMessage.tsx`
- `src/components/assistant/AssistantPanel.tsx`
- `src/lib/activationAnalytics.ts`
- `src/lib/admin.ts`
- `src/lib/i18n.dict.ts`
- `src/lib/productOutcomeAnalytics.test.ts`
- `src/lib/queries/activeMission.ts`
- `src/lib/queries/productOutcome.test.tsx`
- `src/routes/admin.creators.tsx`
- `src/routes/admin.insights.tsx`
- `vite.config.ts`

未部署，沒有遠端rollback。只逐hunk review D17應用／config／test／script patch，保留前輪dirty工作及所有fixtures/history；沒有D17 migration需要逆轉，不reset、不廣泛delete、不改舊checksum。還原後按影響重跑gates。正式release材料已更新可review；真正執行前仍需要當次正式授權。下一項 **D18**，D15內容blocker繼續保留。
