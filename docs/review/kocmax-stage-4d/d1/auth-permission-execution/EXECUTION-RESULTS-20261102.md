# KOCmax 九帳戶登入及跨帳戶權限驗證

執行日期：2026-11-01 晚至 2026-11-02，香港時間。證據時間戳使用 UTC。

分支：`codex/kocmax-studio-stages-1-2`。HEAD：`5c60020091e8e6fee934b61c498bf7518944c433`，另有保留中的本機改動。沒有 commit、push、merge、部署或建立 Instagram／Google Drive 連接。

**登入／權限測試與精確測試資料清理已完成。** 使用者在指定 Supabase SQL Editor 回報清理 SQL 執行無錯；獨立唯讀讀回確認 owned sessions／refresh tokens／AMR claims／private draft 均0，九個封鎖匿名化的 Auth／identity parents、deleted creator profiles 及停用的審計角色保留。實際回執為 `cleanup-completion-20261102T151423Z.json`。這不是正式部署或真實 Instagram／Google Drive 連接；原生 worker 的 logout 失敗與 refresh replay verifier 逾時仍是未驗證限制。

下方「最新續接／確認重發」兩段記錄的是 SQL Editor 執行**之前**的 MCP 逾時歷史。使用者確認曾按 Codex 原生卡片的「允許」；原因尚未定位，詳見 `confirmation-timeout-diagnostic-20261102.md`。

最新續接：2026-11-02 04:16 香港時間，使用者文字回覆「允許／確認」後重送，同一 Supabase 工具仍回報確認過期。新的 READ ONLY 讀回仍為 sessions30／refresh33／AMR claims30／private zero-reward draft1，九 Auth 封鎖、九 creator deleted、roles4／staff4／brand5 inactive、active access0。新回執 `cleanup-confirmation-20261101T201638Z.json` 保留；沒有 query pending、沒有自動重送。使用者清理批准已存在；下一步需釐清實際工具確認卡的顯示／點擊情況，不能靠重複文字批准或繞過工具確認完成。

最新確認重發：2026-11-02 03:55 香港時間，按使用者「再發一次」送出同一 SQL 後，工具再次回報刪除確認過期。重發前 READ ONLY 核對與已審閱 inventory 相符；過期後獨立讀回仍有 30 sessions／33 refresh-token rows／30 AMR claims／1 private zero-reward draft。九個 Auth 仍封鎖、九 creator 仍 deleted，四 scoped roles／四 staff／五 brand memberships 仍 inactive，active access 為 0。沒有自動重送，也沒有 query pending。最新回執：`cleanup-confirmation-20261101T195510Z.json`；前一次 03:20 回執 `cleanup-confirmation-20261101T192021Z.json` 保留。確認卡是否顯示仍不明，先釐清確認通道，避免再次盲目重送。此輪未重做完整非試點指紋；下方指紋仍為其標示時間的既有核對。

## 真實驗證結果

| 驗證層 | 實際結果 | 證據 |
| --- | --- | --- |
| 九帳戶密碼登入及 API／RLS | 265／265 PASS | `api-cases-receipt.json` |
| 同工作區的私人隔離 | C-A／C-P 無法讀取彼此私人 thread、source、brief | API 逐項 HTTP 結果及瀏覽器觀察 |
| 跨工作區隔離 | C-B 不能取得 A 工作區的私人內容或改動草稿 | 同上 |
| 職員寫入限制 | operator／reviewer／finance_viewer 的受限寫入遭正確拒絕 | API capability-code 檢查；operator 實際儲存拒絕畫面 |
| 撤銷後舊 JWT | S-R revision 1 → 2 inactive 後，原本保留的同一 JWT 受限讀寫遭 403 拒絕 | `reviewer-revoked.json`、API 最後一組測試 |
| 桌面 | 九個帳戶均實際登入，1440×1000 核對；C-B 另補同尺寸登入表單提交 | `browser-evidence/browser-cases.json` |
| 手機 | 九個帳戶均在 390×844 實際登入 | 同上 |
| 畫面及導覽 | 50 次原生畫面觀察，沒有觀察到橫向溢出；管理員手機抽屜可展開並導航 | `browser-evidence/index.html` |
| 原有應用資料 | 94 表／110 rows，指紋與測試前一致 | `non-pilot-preservation-20261101T183048Z.json` |
| 原有完整資料範圍 | public／private／Auth／Storage 共 129 表／374 rows，排除精確本輪 ID 後指紋一致 | 同上 |

帳戶：

| Alias | 工作區 | 驗證身分 |
| --- | --- | --- |
| C-A | A | 一般創作者 |
| C-P | A | 同工作區的另一位創作者 |
| C-B | B | 跨工作區創作者 |
| S-A | A | workspace_admin |
| S-O | A | operator |
| S-R | A | reviewer；API 測試中撤銷為 inactive revision 2 |
| S-F | A | finance_viewer |
| B-A | A | 品牌 member；沒有職員身分 |
| U-X | A | 初始 Auth-only，再經正常 API bootstrap 成為一般創作者 |

## 測試界線

九個帳戶都是本輪經 Auth admin 建立的已確認密碼帳戶，沒有發送登入郵件。沒有使用 mock Auth 或 mock RLS 代替上述結果。

九次正常 API bootstrap 已實測；之後只把本輪九個 profile 的 `onboarding_completed` 設為 true、`onboarding_step` 設為 5，供既有帳戶登入畫面核對。沒有調用 onboarding complete 或其 100 分 welcome bonus，也沒有接受或偽造 `creator_consents`。

創作者頁面的條款門檻完整保留。已核對密碼登入、預期阻擋、私人內容的讀取／拒絕渲染；**條款後的創作者操作沒有驗收**。Admin／brand 路由不受此 modal 影響，角色導覽與實際權限畫面已另行驗證。

沒有執行原任務成功加入、發佈、獎賞結算、兌換、AI、原生 Google OAuth、Storage 或外部供應商連接。原 join 會加 10 XP，沒有為測試修改該規則。

圖集保留初始載入、選擇器及 AX diff 的觀察，以及後續核對。不是每個保留中的布林觀察都代表通過；例如早期品牌卡文字選擇器未匹配，之後以實際 DOM 及畫面重新核實。JPEG 原生截圖保留原位元組並附 SHA-256，沒有生成替代畫面。

## 保留的介面發現

1. Operator 的導覽已隱藏任務管理，但直接開啟任務編輯頁仍看到可寫控制項。實際以未改內容的本輪草稿按「儲存變更」，伺服器正確拒絕，輸入保留。這是介面權限提示問題，沒有觀察到越權改動。
2. 品牌 member 的任務卡仍顯示刪除按鈕，雖然原 DELETE 規則需要更高權限。沒有點擊該按鈕作破壞性測試。
3. 一次職員登出觀察中，舊畫面沒有立即更新；重新載入受保護入口後正確要求登入。開發環境的重新載入／擷取時序也影響部分觀察，這仍是需專門回歸的介面項目，不據此宣稱存在授權繞過。
4. 非職員的拒絕文案仍稱「此 Google 帳戶」，即使本輪使用密碼登入。沒有為此修改既有權限控制。

## 清理的實際狀態

已完成並獨立核對：

- 四個 scoped roles 均 inactive revision 2；四個 staff row、五個 brand membership 均 inactive。
- S-O／S-F／S-A 的三次最終撤銷，經既有 audited owner wrapper 完成；S-R 原撤銷保留。
- 九個 creator profile 已透過原產品刪除流程匿名化，九個 Auth 身分保留並封鎖，email 為其精確 deleted-ID 格式。
- 三個 private threads、四個 manual sources、三個 briefs 及十個 Studio commands 已清除。
- 原生助手在後續全域 session logout 階段回報 `SESSION_REVOCATION_FAILED`。原流程先封鎖再要求 logout，沒有把此錯誤忽略為成功。
- 只停止本輪已核實的 root／app PIDs 47520、26536、53236。8784／8785／8786 listener 均為 0。
- 已移除本輪 test-password file、control token file 和 worker lock。沒有讀取或保存 server key。

後續經使用者在 SQL Editor 執行，已於 2026-11-02T14:42:05.610864Z 獨立唯讀核對完成：

- 原 30 個精確本輪 Auth sessions、33 refresh-token rows、30 AMR claims 現均為0；九個 Auth／identity parents 保留。
- 原一個精確 private／draft／zero-reward mission：`446802cb-4f6c-418d-967a-bf5f1cf63ea5` 現為0。兩個工作區及審計 parent rows 保留且權限停用。

實際恢復 SQL 是 `cleanup-sessions-and-draft.recovery.sql`：固定九個 User ID、三十個 Session ID、精確子列數及一個草稿 ID，先核對九帳戶已匿名化／封鎖、角色均停用，再在一個交易內處理。不刪除 Auth users、identities、creator／audit／workspace parents，不解除封鎖，不改 FK、trigger、schema 或 index。相依及數量漂移便整筆停止。

最初的草稿清理要求遇到 Supabase connector 的額外破壞性操作確認過期；讀回證實未寫入。另一次 access-only guard 誤用了 API DTO 的 `pending` 作資料表欄位，交易未寫入；實際查 schema 後改用存在的 `available`，再成功完成 audited access 撤銷。這些歷史結果均保留。

兩次持有新 session 的獨立 refresh verifier，在等待實際完成回執期間到達其 30 分鐘界線，均以 `CLEANUP_BARRIER_TIMEOUT` 停止。**九個 refresh-token 重播拒絕沒有通過驗證，不可用封鎖、空結果或離線測試替代。** 舊 access JWT 亦不能假定因 logout／ban 即時失效。

## 原有資料及近期修正

在 2026-11-01T18:30:48.092005Z 的 READ ONLY repeatable-read 核對：

- 非試點應用資料：94 表／110 rows，digest `ec4e20dce8d53c695122c2f3c1551abb`。
- 非試點完整範圍：129 表／374 rows，digest `ba4d59dfbe6044523379db917fe3c2b3`。
- 以上均與測試前相同。排除只使用精確本輪 Auth／workspace／run ID，及由這九個 User ID 衍生的 session IDs。
- Migration history 16 筆、public／private policies 89；沒有重套已批准 SQL。
- `creators_id_workspace_unique` 與 `integration_creator_workspace_key` 均保留且 valid。第一個支援八個 FK；沒有執行索引或約束刪除。

清理後的線上指紋為129表／388列／`ab2eab43d7fcfd1d377ea9e2ba0ee114`，與上述舊基線不同。離線備份重還原仍精確對上舊129表／374列指紋；14筆新增列已分類為一位非試點創作者的既有 Auth 登入、新建 creator／同意／結餘／投稿／點數與一筆 `storage.migrations`。六張原任務與八個原 Auth ID 均保留；一張任務只變動 `filled` 且對應新投稿，一個 Auth user 的 `updated_at`／`last_sign_in_at`／`recovery_sent_at` 變動。沒有對非試點資料做回退或刪除；舊 digest **不能**當成清理後仍字面相同。細節見 `cleanup-completion-20261102T151423Z.json`。

後端三個權限關鍵檔案與 API receipt 的來源 SHA 相同。新增／修正只涉及本機試點工具、驗證器及證據文件；沒有在本輪改動已通過 API 驗證的產品權限實作。

## 本機工具驗證

- Windows launcher：15 個實際權限／合成輸入／單一路徑 Node 啟動檢查通過，一般使用者身分。
- Worker safety：22 個離線測試通過。
- Cleanup verifier：14 個純測試通過。
- 真實 worker 的合成輸入啟動演練，確實到達 stale-evidence barrier；網絡及 listener 均封鎖。
- 真實 Supabase SDK adapter 以合成 key 在封鎖網絡下構造成功；不當作真實 Auth 驗收。

修正了 launcher 把兩個 Node 路徑串成一個檔名的問題，並在索取 key 前先驗證 Node 啟動。Windows packaged-app 的精確 LocalAppData 實體路徑及兩個 private cache 路徑已加入驗證；logical／physical 位置仍檢查目前使用者／SYSTEM ACL 及 reparse 拒絕，沒有放寬為任意實體路徑。

## 交付檔案

- `api-cases-receipt.json`：265 項實際 API／RLS 結果，沒有 token、密碼或匯出內容。
- `browser-evidence/index.html`：手機／桌面驗證圖集。
- `browser-evidence/browser-cases.json`：逐項尺寸、觀察、限制及截圖指紋。
- `runtime-receipt.native-cleanup-warning.json`：原生清理失敗的原始狀態投影。
- `local-helper-shutdown.json`：已驗證的 process／listener／password-file 清理。
- `non-pilot-preservation-20261101T183048Z.json`：原有資料保留核對。
- `cleanup-sessions-and-draft.recovery.sql`：僅限本輪相依資料的最後清理交易。
- `cleanup-completion-20261102T151423Z.json`：使用者 SQL Editor 執行回報、獨立讀回、非試點差異分類及限制。
