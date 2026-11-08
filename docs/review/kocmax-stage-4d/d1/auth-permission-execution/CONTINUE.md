# 執行續接：登入／權限及精確清理已核對（歷史 checkpoint 保留如下）

## 目前唯一有效狀態：以此節覆蓋下方歷史 checkpoint

- **2026-11-02 23:14（UTC+8）清理完成，已獨立唯讀驗證**：使用者在指定 Supabase SQL Editor 回報完整清理 SQL 執行無錯；`2026-11-02T14:42:05.610864Z` 精確讀回 owned sessions／refresh tokens／AMR claims／private draft 均0，Auth9 封鎖匿名化、identities9 保留、deleted creator9、active access0。`15:12:55.881589Z` 讀回兩個 workspace、四 scoped roles／四 staff／五 brand rows 均保留且停用，Studio／點數／連接測試列0。Migration16、policies89、兩個索引 valid。回執 `cleanup-completion-20261102T151423Z.json`。**下方所有「清理待執行」說明只屬歷史，不可當作目前狀態。** 舊原生 worker 失敗與 refresh replay verifier 逾時仍保留為未驗證，不改寫成 PASS。
- 非試點舊全域指紋沒有字面相等：離線備份重還原仍為129表／374列／`ba4d59dfbe6044523379db917fe3c2b3`，線上為129表／388列／`ab2eab43d7fcfd1d377ea9e2ba0ee114`。多14列已按表與時間分類為一位非試點創作者的登入／同意／投稿／積分資料及一筆 `storage.migrations`；一個既有任務只改 `filled` 且對應該投稿，一個既有 Auth user 的三個時間欄位變更。這些是清理以外的並行活動，**不宣稱舊 digest 相同**；詳見完成回執。個別列／欄位的 hash 盤點僅用於本地比對，沒有留在工作樹。沒有刪除、回退或修改這些非試點資料。
- **2026-11-02 20:25 香港時間 SQL Editor 交接**：使用者已在內建瀏覽器登入，實際核對 `Remix-Adfocate`／`main PRODUCTION` SQL Editor。編輯器仍空白、Run 未按；內建瀏覽器禁止讀取本機檔案，已停止傳送嘗試。已請使用者從本機已審閱檔案自行複製完整 SQL 到編輯器並按 Run。`2026-11-02T12:25:30.093723Z` 唯讀讀回仍有 sessions30／refresh33／附於 sessions 的 AMR claims30／draft1。**清理仍未執行**。下一步在使用者實際 Run 後獨立讀回；任何錯誤停止，不改成寬泛刪除。詳見 `confirmation-timeout-diagnostic-20261102.md`。
- **2026-11-02 19:42 香港時間最新診斷**：使用者確認 Codex 原生可點擊確認卡已出現且已按「允許」；本機 desktop log 也記錄 `mcpServer/elicitation/request` 的 `action=accept` 送出，但沒有證據證明 Supabase 收到或對應到特定 SQL 呼叫。`2026-11-02T11:42:06.593627Z` 唯讀讀回仍有 sessions30／refresh33／附於這些 sessions 的 AMR claims30／private zero-reward draft1，Auth9 封鎖匿名化、creator9 deleted，active staff／brand／scoped role 均0。**清理未執行**。不要再詢問卡片是否顯示／點擊，也不要再盲目重送 MCP；完整診斷與可行的 SQL Editor 路線見 `confirmation-timeout-diagnostic-20261102.md`。下方舊段落的「卡片情況不明」已被此證據取代。
- **2026-11-02 04:16 香港時間最新結果**：使用者文字回覆「允許／確認」後，先於 `2026-11-01T20:01:54.497335Z` READ ONLY 核對，再送出同一已核實 hash 的 recovery SQL。工具仍回報 `expired / INVALID_ARGUMENT`。`2026-11-01T20:16:38.149229Z` 獨立讀回 sessions30／refresh33／claims30／private zero-reward draft1、封鎖 Auth9／deleted creator9、inactive roles4／staff4／brand5、active access0。回執 `cleanup-confirmation-20261101T201638Z.json`。**清理仍未完成、沒有 query pending、沒有自動重送。使用者清理批准已足夠，不能再把重複授權當作解法；須釐清是否實際看見並點擊工具確認卡。** 不繞過工具確認，不重開 helper 或索取 key。原失敗回執保留，完整非試點指紋仍為先前標示時間的結果。
- **2026-11-02 03:55 香港時間最新重發結果**：使用者「再發一次」後，於 `2026-11-01T19:41:09.850075Z` READ ONLY 重核精確 sessions30／refresh33／claims30／private zero-reward draft1、封鎖 Auth9／deleted creator9、inactive roles4／staff4／brand5、active access0；最新 SQL hash 與分支／HEAD 相符。同一 Supabase connector 再次回報 `expired / INVALID_ARGUMENT`。`2026-11-01T19:55:10.897698Z` 獨立讀回以上數量不變。回執 `cleanup-confirmation-20261101T195510Z.json`，**清理未完成、沒有 query pending、沒有自動重送**。確認卡是否顯示仍不明；先釐清確認通道，不能持續盲目重送或繞過工具確認。未重做完整非試點指紋，原失敗／逾時證據保留。
- **前一次：2026-11-02 03:20 香港時間確認重發結果**：已按使用者「重新發出清理確認」要求，先於 `2026-11-01T19:01:15.014395Z` READ ONLY 核對精確 30 Session IDs／ownership、33 token children、30 AMR claims、九個零子列 mission FK 及兩個既有 cascade FK，再送出同一最新 recovery SQL。工具再次回報 `expired / INVALID_ARGUMENT`，沒有自動重送。`2026-11-01T19:20:21.816098Z` 獨立讀回仍為 sessions30／tokens33／claims30／draft1、封鎖 Auth9／deleted creator9、inactive roles4／staff4／brand5、active access0。清理未完成，沒有 query pending。回執 `cleanup-confirmation-20261101T192021Z.json`；原失敗／逾時證據保留。此輪沒有重新計算完整非試點資料指紋，不把下方舊核對時間當作本輪結果。
- 九帳戶 API／RLS **265／265 PASS**；桌面 1440×1000、手機 390×844 各九帳戶實際密碼登入完成，50 次畫面觀察。圖集及來源指紋在 `browser-evidence/index.html`、`browser-evidence/browser-cases.json`；詳細限制見 `EXECUTION-RESULTS-20261102.md`。
- **四 roles inactive revision2、四 staff inactive、五 brand memberships inactive**。三個最終撤銷已走 audited owner wrapper，S-R 原撤銷保留。
- 原產品流程已把九 creator 匿名化、九 Auth 身分封鎖並改為 deleted-ID email；三 thread／四 source／三 brief／十 Studio command 均 0。
- 原生 cleanup 在 ban 後 logout 全數得到 `SESSION_REVOCATION_FAILED`，保留於 `runtime-receipt.native-cleanup-warning.json`。不能宣稱原生 worker 成功，也不能重做正常密碼登入已 ban 的帳戶。
- **root／apps 已停止**：PIDs 47520、26536、53236；8784／8785／8786 listener 0。test-password file、control token／lock 及兩個 owned Vite caches 已移除。server key 只曾在程序記憶體，**不要再索取 key 或重啟 helpers**。`local-helper-shutdown.json`、`local-cache-cleanup.json` 是實際結果。
- 剩餘 **30 owned Auth sessions／33 相依 refresh-token rows／30 AMR claims，及一張 private draft mission**。目前所有 Auth／creator／workspace／audit parents 保留。最後一筆恢復交易在 `cleanup-sessions-and-draft.recovery.sql`。
- Supabase connector 的破壞性 SQL **額外確認已過期，讀回證實沒有執行 session／draft 清理**。Raman 最後回報沒有 query pending，不可把逾時當作執行成功，也不可自動繞路或重新提交；使用者方便按即時工具確認時再發同一 scoped request。
- 該 recovery SQL 已把 PL/pgSQL 陣列變數改為 `pilot_user_ids`／`pilot_session_ids`，避免與 `auth.users`／`auth.sessions` whole-row 名稱衝突。READ ONLY 對照 probe 已證實原命名失敗、改名版取得正確 user/session match。**重新讀最新檔與 hash，不使用舊已送出文字。**
- 再執行前重新核對 exact Session IDs、九個已封鎖匿名化 User ID、33/30 子列及零相依 private draft。漂移便停止／更新 inventory，不能按寬泛前綴清除。不要解除 ban、刪 Auth users／identities、改 FK／trigger 或刪 audit 來強行完成。
- 兩次 refresh verifier 均因等待完成回執到達 30 分鐘上限，最後為 `CLEANUP_BARRIER_TIMEOUT`；原 JWT／refresh token 參照已清除。**refresh-token 重播拒絕沒有通過驗證**，不要偽造 barrier 或重新登入 banned users 來湊 PASS。
- 2026-11-01T18:30:48.092005Z：非試點 app 94 表／110 rows digest `ec4e20dce8d53c695122c2f3c1551abb`，完整 public/private/Auth/Storage 129 表／374 rows digest `ba4d59dfbe6044523379db917fe3c2b3`，均與測試前相同。Migration16、policies89、兩個 creator 索引 valid 且保留。見 `non-pilot-preservation-20261101T183048Z.json`。
- 最後 SQL 成功後：獨立讀回 sessions／tokens／claims／mission 0、parents9 retained/banned、roles4 inactive、非試點 digest 不變，新增真實 recovery receipt；**保留原生失敗／verifier逾時回執，不把它們改成 PASS**。再更新 canonical summary。沒有部署或真實 Instagram／Drive 連接。

## 先前執行中的 checkpoint（歷史）

**不要再要求金鑰，不要重開／停止 root worker，不要重建帳戶。** v4 已實際 READY；root exec session `21776` 持有原 key 於記憶體，兩個 app 已啟動，九個 Auth 帳戶及 fixtures 均已建立。`continuation-status.json` 的 `liveCheckpoint` 是最新進度；下方先前「等候輸入」段落屬歷史，不可當成目前狀態。

- API runner 已完成 **265／265 PASS**，case run `01db1d1f-23a5-4b83-9d25-8da8cddabc63`，見 `api-cases-receipt.json`。正常 bootstrap、跨帳戶／工作區私人資料、零餘額、匯出範圍、職員寫入限制及撤銷後原 JWT 拒絕均已實測。
- S-R 已透過 audited owner wrapper 撤銷為 inactive revision 2；`reviewer-revoked.json` 已解鎖原 JWT runner。不要重跑 revision-1-only revocation。
- 九個 creator 只設定 synthetic `onboarding_completed=true,onboarding_step=5`，XP 仍 0，`creator_consents` 仍無記錄。沒有調用 onboarding complete／welcome bonus，沒有接受或偽造條款。
- 桌面 1440×1000 已實際登入全部九帳戶；手機 390×844 正進行。最新逐項證據、尺寸及截圖在 `browser-evidence/browser-cases.json`；只按實際 `metrics` 採計正確尺寸。早期 B tab 的 1280×720 已另外在正確桌面尺寸重核，不可算成指定尺寸驗收。
- Creator 頁面合法同意 modal 保留；可記錄正確登入與門檻／底層私人渲染，**不能聲稱條款後互動已驗收**。Admin／brand 路由不受該 modal 影響，已實測角色畫面及 operator 寫入拒絕保留輸入。
- UI 發現：受限 operator 可直接開 mission edit 並見可寫控制項，但儲存被 server 拒絕；沒有改動原 guard。品牌只限 member 也顯示刪除按鈕；不要點擊刪除來試，清理用精確 owner SQL。
- 一個 owned draft mission：`446802cb-4f6c-418d-967a-bf5f1cf63ea5`，slug `kocmax-auth-5f694251-c6eb-4f5f-a281-25e91db81c04-api-draft`，private／draft／zero rewards。Studio 共三 thread／四 manual unverified private sources／三 brief；IDs 在 API receipt。
- CUA 仍持有 `pilotBrowser`（iab）、`pilotUiA` 桌面 tab 29、`pilotUiB` 工作區 B tab 30、`pilotMobileA` 手機 A tab 31。Viewport override 只作用當前分頁；每次按實際 DOM 尺寸核對。`pilotAccounts` 僅九個測試密碼存在 CUA 記憶體，**不可列印**，完成後清空；key 不在此變數／檔案。
- Owner 全域 nonpilot 基線為 129 tables／374 rows／`ba4d59dfbe6044523379db917fe3c2b3`，在 15:35Z 及排除 exact owned IDs 後 15:49Z 均相同。最新 gate 已反映九個 owned Auth 碰撞與兩 owned workspace；需要 freshness 時用實際新唯讀查詢，不改時間戳。

**清理必要，尚未執行。** 完成手機後：保存精確 inventory → 刪除 only owned draft（檢查無依賴／private／zero）→ owner audited revoke S-O/S-F/S-A（S-A staff active 留到最後一個 grant call 完成；S-R 已 inactive2，不重做）→ deactivate 四 staff 及五 brand membership → 寫完整九人 `fixture-role-revocation-receipt.json`（C-B 對 B，其他對 A）→ worker `cleanup` 走原產品匿名化／ban／全域 session revoke／移除 passwords。保留必要 Auth／creator／兩 workspace／staff audit parents，不 cascade／hard-delete Auth。

Raman 已只讀覆核上述次序；Epicurus 正在新增 `verify-auth-pilot-cleanup.mjs` 與純測試，**parent 尚未審閱／執行**：預計在 cleanup 前持有九個新 session 於記憶體，cleanup 後驗證 refresh 被拒絕及舊 access 的實際殘留範圍。先讀其回報及 barrier contract，再決定執行；不要在清理後才嘗試重新登入已 ban 帳戶。

## 先前準備及啟動歷史

2026-11-01。使用者已明確批准 SQL、還原驗證、九帳號實測及清理；不用重新要求同一批准。不部署、不連 Instagram／Drive、不發信、不用外部 AI、不發放獎勵。

## 已完成

- 分支仍為 `codex/kocmax-studio-stages-1-2`，HEAD `5c60020091e8e6fee934b61c498bf7518944c433`，未提交／推送／部署。
- 新備份 `20261101T073819Z-4e90d939a7a144639faa6a720e0d1f6c` 完整讀取及實際隔離還原通過。94 張 app 表／110 筆資料、86 policies、15 migration 基線一致；原 archive／manifest 未改，自己的容器已清理。
- 已一次套用精確 6,869-byte SQL，SHA `ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d`。資料庫 history 的 statement bytes／SHA 實際相符。
- migration 為 `20261101075946 / kocmax_auth_permission_boundary`，history 變為 16，policies 變為 89，兩個新函式的 ACL／search_path 正確，原 app 資料指紋不變。
- 本機新 migration 檔已與 history 版本對齊；release manifest 加入新項，保留原項目。manifest write／check 通過。
- `application-receipt.json`、`checkpoint-restore.json` 是實際結果；舊準備回執仍保留歷史狀態。

## 必要輸入

需要現有 Remix-Adfocate `mhkoayftiuojxlrkollf` 的 service_role／server secret key。未在工作目錄、原 repo 或目前可用環境找到。Supabase connector 只提供公開 key；目前 Vercel connector 的 environment list 返回 403，沒有繞過或擴大權限。

本機安全視窗由 `open-auth-pilot.ps1` 啟動。最新續接：原 `Set-Acl` 的 `SeSecurityPrivilege` 問題已重現並修正，7 個實際 Windows 權限案例及 20 個 worker 安全案例通過。舊 run 只留下 `control.json`，已核對沒有執行中助手／listener、沒有帳戶密碼或 ownership journal，再於同一私密父目錄改名原封保留，詳見 `launcher-recovery.json`。未建立 Auth 帳號或測試根資料。

使用者回覆已啟動後，實際核對 session `81186` 已在 `SERVER_KEY_REQUIRED` 檢查停止，未啟動 worker／建立新 private run 或帳戶；未讀取輸入內容。失敗回執為 `launcher-key-input-failure.json`，舊視窗回執為 `launcher-input-window.v2.json`。

目前已直接開啟並核實 **v3** 安全輸入視窗，exec session `40583`，實際程序見最新 `launcher-input-window.json`。v3 在同一視窗顯示輸入類型／格式問題，可原地更正；14 個權限及合成輸入案例、實際表單點擊 smoke test 通過。不要重複啟動或停止使用者正在輸入的視窗。此前 Hidden 啟動但沒有可見視窗的本輪程序 `44352` 已在尚未建立新 run 時停止；不要沿用舊 session `39410`／`81186`。

若目前視窗已關閉，而且沒有執行中 helper／既有 run，才由使用者自行執行：

```powershell
& "$env:USERPROFILE/.codex/worktrees/kocmax-studio/Adfocate/scripts/integrations/open-auth-pilot.cmd"
```

不用建立／輪替 key，不能把 key 貼到對話。helper 只經記憶體及匿名 pipe 傳給 worker，不把 server key 放入 argv、env 檔或報告。不要取消一個正在由使用者輸入的視窗；如需結束舊 helper，先確認它仍未建立 private run／任何實際帳號，再只處理本輪程序。

本輪修正只涉及本機 launcher 與其回歸驗證，沒有重套 SQL，也沒有開始九帳戶實測。詳細修正與測試限制見 `launcher-acl-fix.md` 及 `resume-20261101-key-input.md`。資料庫 readonly gate 已以 `2026-11-01T15:02:29.773095Z` 實際唯讀核對結果原子更新，原 app 資料指紋未變，預留九 email／兩 workspace 零碰撞。若執行時已過 15 分鐘，仍須重新實際核對，不能只改時間戳解鎖 worker。

## 續接次序

1. 讀 `startup-status.json`／`runtime-receipt.json`。若 key 已輸入但 metadata 過期，worker 會在 **建立 client／listener 前**以記憶體保留 key，等候最多 60 分鐘；完整驗證不放寬。
2. 使用同一 project/link 做新的 READ ONLY gate：實際 transaction_read_only、row_security off、Auth user triggers=0、九個保留 email／兩個 workspace 無外來碰撞、已套用 SQL 的 history SHA 相符。把實際時間／結果**原子替換**到 `auth-pilot-readonly-gate.json`；worker 每秒讀取，不能用部分寫入 JSON 或編造新時間解鎖。
3. `node scripts/integrations/auth-pilot-control.mjs --action status`，確認 READY。再 `--action create-users`。不自動重試 ambiguous create；先查 exact candidate／ownership journal。
4. `users-created.json` 應有九個實際、confirmed、createdThisRun 身份。用 `createAuthPilotFixtures` 及原 prepared manifest 產生 seed SQL；先記錄回執，再以 parent MCP owner 執行精確交易。產生 `fixture-seed-receipt.json`，形狀見 worker header。只建兩個 workspace、四 staff、五 brand membership、四 audited scoped roles；不先建 creator，U-X 保持 Auth-only。
5. `--action start-apps` 啟動 real source 本機 A:8784／B:8785。啟動前若 gate 過期，先重新驗證並原子更新。三個 Studio flags 已 true，providers false，exact studio_command POST 可用；AI／發信／獎勵 RPC 仍禁用。
6. 在 worker `login-all` 或 UI 之前執行：

```powershell
node scripts/integrations/run-auth-pilot-cases.mjs --execute-approved-cases --public-key-file docs/review/kocmax-stage-4d/d1/auth-permission-execution/runtime-public-config.json
```

它使用公開 key＋專用密碼作真實 Auth，JWT 只在記憶體；先測 U-X Auth-only，再正常 API bootstrap 九名。`api-bootstrap-ready.json` 供 parent 設定本輪既有創作者狀態；不接受 ToS／consent，不把 onboarding 標成實測。UI 如需 completed，可只對本輪九名作明確 synthetic fixture 設定，保留實際首次 bootstrap 證據。

7. runner 建一個 private draft／零獎勵任務作正向及負向對照；依 factory 建三 thread／四 manual unverified private sources／三 briefs。它會停在 `api-awaiting-reviewer-revocation.json`；用 factory.roleRevokeSql() 把 S-R revision 1→2 inactive，核對後寫其 expectedReceipt 到 `reviewer-revoked.json`，讓同一舊 JWT 重播。
8. 以 **in-app browser** 做九帳號實際登入及 390×844／1440×1000 journeys、重新整理、切帳號／快取、來源及 Brief 私人邊界、品牌與受限 staff 頁面。全程不用 mock fixture／OAuth。Root key 不進瀏覽器，private accounts 密碼不寫入報告或儲存在瀏覽器。
9. 清理前先處理精確 draft mission ID、記錄 inventory；MCP 以受審計 owner 路徑撤銷本輪角色、deactivate memberships／staff，保留最後有效清理 actor 到最後。對完整九名寫 `fixture-role-revocation-receipt.json` 後才 `--action cleanup`。
10. cleanup 走原產品匿名化／ban，再全域 revoke session，只處理 exact owned IDs，保留 audit／必要 Auth 父列。不可 hard-delete Auth、cascade workspace、改 FK／觸發器／帳本來湊零殘留。實際 stale JWT／檔案／到期結果及最小保留列須另行核對，不能把 session revoke 當 JWT 立即失效。

## 已準備及限制

- Worker 五 action：status、create-users、start-apps、login-all、cleanup；control 只接受 loopback／Bearer private token，沒有 Root 泛用 proxy。
- Private path：`C:/Users/laich/AppData/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04`，current-user／SYSTEM-only ACL。可包含 private control token、九個 UI 密碼、ownership journal 及本機 Vite cache；server key 不入檔、JWT 不持久化。
- Root control 來源：`scripts/integrations/auth-pilot-worker.mjs`、`auth-pilot-local.mjs`、`auth-pilot-control.mjs`；factory：`auth-pilot-fixtures.mjs`；case runner：`run-auth-pilot-cases.mjs`。
- 全 app＋Auth＋Storage 的 pre-test opaque baseline 是 `non-pilot-baseline.json`：129 表／374 rows。未讀出 row values。後續只排除由成功回執證明本輪建立的 UUID／run ID；不得用寬泛字串隱藏原資料變更，真實並行活動須分類。
- 共用 DB 正向 join／成功兌換／獎賞發放排除：原 join 實際加 10 XP。不要改原獎勵規則來配合測試；未做的情境列 NOT_RUN。
- 目前九帳號、mobile／desktop real login、RLS runtime、持久化及 cleanup **均未執行**，不能用離線綠燈替代。
