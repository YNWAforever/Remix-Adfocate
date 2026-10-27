# D17 R2 本機品質及 advisor owner 交接

已完成本輪可獨立驗證的本機修正；具名 owner、裝置及 hosted 驗收仍 **BLOCKED**。未部署，沒有 commit、push、merge 或正式資料／membership／角色變更。D15 四堂核准教材 blocker 與真實 provider disabled 保留。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`。Source fingerprint `cdf8597d00d4cf716823a420296cb0e40ba1fa13e0fa11ca7feb735f8f04c996`，348 records；9份source差異（4既有UI＋5測試／runner／config），沒有另建 workflow／proof／reward／release engine。

| 層次 | 本輪結果 |
| --- | --- |
| Code | 頂欄完整標題與穩定載入slots；指南長標題換行；鎖定卡正常對比；首頁預留工作／收益卡載入空間 |
| Test | 1954 pass／363明確gated skip／0fail／275files；原16＋194不改；5個final Edge cases＋1個獨立post-gates效能case；5個static gates |
| Deployment | 未部署；canDeploy／canEnablePilot=false |
| Runtime | 12頁、48個320/360/390/768 CSS reflow cells、12頁axe選定A/AA規則0 violations；鍵盤切換／原輸入／retry；100次真實本機queue讀取；兩個隔離庫唯讀advisors |

## 回歸與最小修正

頂欄在1024／1280px時標題被擠至0／10px；課程指南320px時scroll327px；鎖定課程卡因整卡opacity而有34個低對比節點。先保留RED，再分行／換行／保留文字對比；資格及鎖定導向不變。新增效能量測再找到loading CLS：職責與workspace回讀造成頂欄換行，首頁工作／收益卡由短loading膨脹。以實際shift source rectangles定位後固定desktop slots並預留既有卡片載入空間，沒有延遲內容或放寬門檻。[完整test history](D17-R2-test-history.json)、[最終browser](D17-R2-browser-final.json)、[reflow](D17-R2-responsive-final.json)、[axe](D17-R2-axe-final.json)。

原輸入的鍵盤測試沒有Save；內容503為明示transport mock，Retry後回真實API讀取。沒有建立／批准課程。[Keyboard](D17-R2-keyboard-final.json)。

## 效能與可存取性邊界

最後sequential post-gates：12頁最高LCP **744ms**、最高CLS **0.012834**；100次exact-owned兩位Creator queue p50 **52.12ms**／p95 **59.44ms**，每次total2且兩個ID正確。所有raw樣本保留。[最後樣本](D17-R2-performance-profile-final-post-gates.json)。先前一次full browser的尾段與typecheck曾短暫重疊，保留當時數據並在所有gates完成後獨立重取；沒有刪outlier。

Installed desktop Edge／production assets／1280×900／loopback，無CPU或網絡throttle；外部請求被攔截而使用fallback fonts，routing使HTTP cache disabled，DB/server warm。toNetworkIdle包含idle等待，與LCP／INP不同。這輪沒有重取1k/10k、24互動、INP或bundle拆包比較，也不是field p75。320 CSS width沒有冒作native200%zoom。無實機／Safari/WebKit／manual screen reader／hosted驗收，axe亦不等於全產品認證。

另外以mock先驗證missing mapping／wrong port／non-loopback三項RED，再加DB container發布port gate；4項green後才重取真實唯讀advisors。沒有在mock內建立client或連線。[Identity RED](D17-R2-advisor-port-red.json)、[GREEN](D17-R2-advisor-port-green.json)。

## Advisor owner：交接可review，簽收仍受阻

Fresh local empty217＋shaped176＝**393**（297INFO／96WARN／0ERROR）。D17原463、D18原471完整不改；聯集**481**逐項保留role、risk、disposition與validation，現在未觀察到的88項仍open。差異源於local workload statistics，沒有當作修復。6個proposed owner roles全部`namedOwner=null`／PENDING；沒有收到任何人的名字、authority或接受reference，亦無hosted證據。[481項checklist](D17-R2-advisor-owner-checklist.csv)、[owner驗收要求及缺口](D17-R2-advisor-owner-acceptance.json)、[本輪notices／catalog原始資料](D17-R2-advisors.json)。

具名owner下一步需逐項提供真實名字及權限reference、review相同target/schema/source/timestamp下的風險與驗證、記錄明確decision／acceptedAt／evidence；hosted需另有授權及project身份。角色名稱、這份文件或agent不可代簽。不得只為消警告加寬policy、改grants、刪index或把local未用統計當production結論。這份清單不授權正式變更或release。

## Schema、持久化與財務

沒有SQL、migration、RLS、grant、function、history、membership或角色改動。Manifest42，digest `3e6809f9a51b1ac7ebb9f770160aab27f02523ebf69fc47f8fe38f44d05f6363`；兩個exact target的指定catalog/history與D19相同，history72／56，inspection前後一致。[Schema diff](D17-R2-schema-diff.json)。`brand_users.user_id`單workspace PK不變。

沿用R2 owned fixture，沒有seed／fixture新建或清理；4 Auth、2 workspace、3 parent、0 lesson，既有membership1／workspaceRole1／platformRole1保留。[Exact-ID retention](D17-R2-fixture-retention.json)。兩位Creator的raw points／XP／withdrawable／ledger／budget／inventory前後一致：[final UI](D17-R2-neutrality-final.json)、[post-gates](D17-R2-neutrality-profile-final-post-gates.json)。沒有pending reward／付款操作；D19 funded pending/cancel/reapproval及完整legacy/active角色交接保留原fingerprint歷史，沒有稱本輪R1重新verified。

## Gates、未測與rollback

[每條命令／exit](D17-R2-gate-exits.json)、[逐assertion與skip](D17-R2-suite-results.json)、`logs/D17-R2-*`保留失敗與成功。4個原有lint warnings及route/bundle warnings仍有記錄。363個gated skips不是PASS；沒有跑共享seed/reset integration。缺durable operator start/decision／狀態求助來源的結果量度繼續顯示unavailable，未填造0或pilot成效。

原107 cases、28 findings及CSV原欄位／originalAuditResult保留。只更新UC-Q01/Q02/Q03、F20及D17的newResult；104個其他case及其他19個task原紀錄保留。D15、正式staff、real provider、所有正式release blockers未被本輪測試解除。

Rollback只review本輪[9份source patch](D17-R2-changes.patch)及[changed files](D17-R2-changed-files.json)，以before-images逐hunk還原，保留既有dirty工作、fixtures與evidence。`git apply --check --reverse --ignore-space-change docs/verification/D17-R2-changes.patch`只作check，沒有實際還原；無DB rollback或remote rollback。還原後按影響重跑gates。

下一項仍為 **D17 外部驗收**：具名owner／authority與逐notice決定、獲准hosted證據、native zoom、實機／Safari／manual AT及field量測。D15教材及正式staff銜接為獨立blockers。[交付總檔](adfocate-delivery.json)、[本輪machine record](D17-R2-delivery.json)。
