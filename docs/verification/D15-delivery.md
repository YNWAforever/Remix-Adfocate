# D15 交付紀錄

D15 的課程工具與持久化進度已完成 local／disposable 合成驗證。**BLOCKED_CONTENT_NOT_PROVIDED**：你已確認目前沒有核准教材。UC-C18／UC-A51 原「四堂真實課程」驗收保持未完成，沒有以兩單元 fixture 或準備中畫面取代。未部署。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`。執行介面核實 `gpt-6.1-sol`，沒有切換模型。沒有 commit、push、merge 或 deploy；既有 dirty 工作保留。

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 真正的版本化單元、作者表單／預覽／排序、本人的持久化進度 | 140 targeted；1762 full pass / 350 skip；原16 audit +194契約全綠 | 未部署 | 12 real API/RLS、4 Edge；兩位 Creator raw neutrality 一致 |

## 行為、角色及持久化

延伸現有 AcademyEditor／adminAcademy／track detail／資格引擎。Operator 可儲存雙語單元草稿、預覽 Markdown、排序、刷新讀回，再以手動核准 reference 發布。已發布單元保持不可變快照；修改建立新 contentVersion 草稿，發布時原子替換 current version。未完成的草稿或 draft parent 對 Creator 隱藏。沒有從 duration／「4 lessons」metadata 生成假內容或課數。

Creator 看到實際 published 單元與實際 total；完成動作只使用登入本人，唯一 `(creator_id,lesson_id,content_version)`，四個 concurrent requests及重送只保留一筆與原完成時間。刷新／新讀取仍1/2；另一 Creator0/2，讀不到也不能偽造別人的進度。新版本不承接舊版完成，舊 completedAt／history 不被改寫。原有 raw level + owner_verified 信任門檻保留，XP高但未驗證仍 locked。真正的單元正文由新 table RLS 保護；既有 legacy academy_content raw published-only policy未改。[API證據](D15-api-contract.json)、[catalog](D15-schema-after.json)。

Edge 4條角色流程：作者建立兩單元→正文預覽→儲存／刷新／發布；Creator明示503寫入 mock後保留正文及0/2，恢復真實完成後刷新1/2；另一帳戶0/2與locked正文不可見；operator更新未完成單元至v2，舊頁真實409保留讀取內容，明確刷新後才可完成v2，最終2/2刷新一致。[作者](D15-author-ui.json)、[Creator](D15-creator-ui.json)、[隔離](D15-isolation-ui.json)、[409](D15-conflict-ui.json)、[browser summary＋持久化rows](D15-browser-summary.json)。作者409單測另外驗證保留本地正文、比較最新版本、只rebase已修改欄位。成功寫入與409均使用真實本機 Auth/API/RLS/DB；只有503錯誤路徑為明示 transport mock。

最終 run `d9c86453-c8a7-42eb-9353-1df5dd59309c`。同一 owned Docker project/container/image/network及loopback映射在client/setup前核實；未查正式庫。Edge operator1280×900、Creator390×844模擬，非實機或Safari。合成 reference只作測試 staff attestation，沒有宣稱真實教材已獲核准。正式內容及完整原驗收仍 blocked。

## Schema、財務及安全

三份 CLI命名 forward migrations新增 `academy_lessons`／`creator_lesson_progress`、RLS、SELECT-only tables、auth-only read/complete RPC、service-only author command、immutable history trigger、version unique keys與FK索引。第一版 private wrapper權限及domain conflict問題以第二份forward修正，沒有改已套用migration checksum；第三份補核准人FK索引。現有global Academy staff gate、active workflow membership、單workspace `brand_users PRIMARY KEY(user_id)`均保留。

Empty history67→70，shaped51→54；舊history差異保留，沒有reset／盲目db push／history修復。原37份manifest entries及舊SQL原樣，新增30個capabilities；current digest `e9e801ff06c0c5382ec18e06ca0d9f05dc7a3d8a4ab1b68633e7f7bc5f14ca75`。兩個目標 local Supabase db lint皆沒有schema errors，D15FK全部有索引，SECURITY DEFINER search_path固定空值，匿名及跨人直接寫入受限。[Manifest/diff](D15-schema-diff.json)、[before](D15-schema-before.json)、[after](D15-schema-after.json)、[lint](D15-db-lint.json)、[forward receipts](D15-forward-replay.json)。Hosted advisors未查，不能代替正式schema／RLS驗收。

兩位 Creator raw XP0／6000、points各50、withdrawable0、point/cash/budget ledgers0、redemptions0、inventory空、budget原null，前後完全相同。課程完成沒有XP／reward／ledger／可提現額／預算扣款，沒有付款功能。[API及UI原始neutrality](D15-browser-neutrality.json)。所有5輪fixture，含RED及失敗輪次的exact IDs、14個content、33個version rows及13個progress rows均保留；沒有清理、廣泛delete或seed/reset。[Retention](D15-fixture-retention.json)。

## 驗證與限制

先保留API3項RED、UI3項RED、作者1項RED，再最小實作。真實integration找到權限與serialization錯誤碼問題，透過獨立forward修正；另修fixture的workspace_id。更新release tests的migration清單／capability數量及正確index mapping，沒有刪除471項舊capability validators、16稽核或194契約斷言。最終type-check、lint、manifest、Node22 build、21檔targeted/release foundation及255檔full suite全通過；4個既有lint warnings及route/bundle warnings保留。[全部命令／counts／logs](D15-delivery.json)。最後API/browser/full suite/source checkpoint一致，沒有測後改碼。

Skip不是PASS。未執行帶共享seed／cleanup的broad integration，以本任務owned12項integration補足。沒有重跑整套legacy/active proof/reward交接；earlier R1/D19 runtime只在原fingerprint保留，不宣稱新manifest已重新取得完整R1或production readiness。原107案例／28findings／CSV原欄位與originalAuditResult不覆寫。沒有CI、部署、正式資料／membership、真實通知／邀請／社交發布、付費provider／AI／付款、實機／Safari／完整a11y／負載驗收。canDeploy／canEnablePilot仍false，沒有延長evidence expiry。

## Changed files、rollback與下一項

本輪24個code/test/script/schema差異，candidate fingerprint `86932f69af586024db602aaf5a83897b61ee99ee449be1a580b800bba29ea777`；前輪 `27e174353ec8455d0fdfcb795c03724e7f1e85c8598fcdf1097957ef76989c85`。[D15獨立patch](D15-changes.patch)、[完整inventory](changed-files.json)、[prior checkpoint](D15-prior-code-fingerprint.json)。

- `e2e/academy-learning.spec.ts`
- `scripts/audit/run-academy-browser.mjs`
- `scripts/audit/run-integration.mjs`
- `scripts/release/contracts.ts`
- `scripts/release/manifest.test.ts`
- `scripts/release/manifest.ts`
- `scripts/release/preflight.test.ts`
- `server/app.ts`
- `server/routes/academy.ts`
- `server/routes/academyLessons.ts`
- `server/routes/adminAcademy.ts`
- `server/test/audit-academy-progress.test.ts`
- `src/components/AcademyLearning.tsx`
- `src/components/admin/AcademyEditor.tsx`
- `src/components/admin/AcademyLessons.authoring.test.tsx`
- `src/components/admin/AcademyLessonsEditor.tsx`
- `src/lib/academy.ts`
- `src/lib/academyProgress.ts`
- `src/routes/-academy-learning.test.tsx`
- `src/routes/_app.guide.track.$trackId.tsx`
- `supabase/migrations/20261023091050_academy_learning.sql`
- `supabase/migrations/20261023093445_academy_learning_conflicts.sql`
- `supabase/migrations/20261023095521_academy_approval_index.sql`
- `supabase/release-manifest.json`

未部署，無遠端rollback。若需還原應逐hunk review D15 patch，保留先前dirty工作；保留所有已持久化單元／進度／history，不DROP或反向migration、不篡改checksum/history、不reset或清fixture。若日後需資料containment，按當次授權經現有operator流程unpublish parent；再以forward修復。舊應用可暫不讀新表，但部署前仍須重新驗證schema及Auth/RLS。發布材料已準備可review；正式DB／release／membership授權留待真正操作前處理。

下一項獨立D任務：**D17**（效能、可存取性及產品結果量度）；D16已有先前交付紀錄。D15核准內容blocker繼續保留。
