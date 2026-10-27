# D12 交付紀錄

D12 已完成 local／disposable 驗證；未部署。沿用 `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`；沒有 commit、push 或 merge。

作者以可讀的交付標題、平台、必需項目、收貨、審稿／修稿時限、檢查清單、發布指示／期限、披露及帳戶設定任務。新任務可勾選需要佐證，毋須寫 JSON。進階 JSON 收於可展開區；舊未知 nested key 原樣保留。現有 proof 引擎只把非空 object 視為需要至少一份佐證，本輪沒有新增截圖數量或逐 key enforcement。

## 四層結果及 gates

| code | test | deployment | runtime |
| --- | --- | --- | --- |
| 已實作，沿用現有 authoring RPC／workflow／proof，順序作者 self-review | targeted 106 pass；full 1702 pass / 324 skip；原16稽核與194契約全綠 | 未部署 | 6/6 real API；3/3 Edge E2E；真實本機 Auth/API/PostgREST |

完整命令、counts及logs見 [D12 JSON](D12-delivery.json)。Node22 build、native emitted ESM、type-check、lint、manifest及diff gates通過。4項既有lint warnings、route exports及bundle size warnings保留。跳過項目不當成通過；沒有聲稱本輪重跑所有舊R1 integration。首次完整套件的兩個舊英文欄位 selector失敗保留，改用實際繁中名稱後原 payload assertions完全不變，5/5 targeted通過，再重跑完整suite。

## 行為、E2E及 neutrality

Client與server共用原有純workflow校驗，server publish補回模板檢查，原子 `author_mission_workflow` 沒有更改。無效 JSON／負期限不可儲存；切換流程亦檢查保留的 JSON，不會在處理錯誤前拋例外。錯誤定位具體交付；交付欄位隱藏或儲存失敗時焦點移至摘要，503／409保留輸入，pending鎖定表單防重送。Preview明示批准後相對時限，不假造批准版本或日期；CPM亦不預覽舊固定獎勵。

最終run `5ba41678-aa1a-42c8-8fa1-beee1b972542`：[預覽→503保留→真實儲存→重載→隔離任務active→Creator加入／交稿→既有operator API批准→Creator重載guidance](D12-authoring-roundtrip.json)。Creator 390px無水平溢出。發布指示、披露、帳戶與證明policy和已保存模板一致。[未知policy UI重載](D12-unknown-policy-roundtrip.json)、[取消頁籤／SPA／關頁及確認離開](D12-navigation.json)。預覽沒有API寫入；儲存成功導航沒有多餘確認。[預覽截圖](D12-authoring-preview.png)、[Creator guidance](D12-creator-guidance.png)。只有本機合成任務狀態改為active，沒有對外社交發布。

作者API操作前後 XP=0、points=50、withdrawable=0及ledgers／budget／inventory相同。[API快照](D12-api-contract.json)。既有成功join後量度review流程，XP=10、points=50、可提現=0、cash/point/budget ledger=0、redemption=0、budget=null、inventory=[]前後完全相同。[SQL快照](D12-browser-neutrality.json)。沒有重寫setup數值，也沒有新增ledger、扣預算、pending reward完成或付款功能。D12沒有重新走proof提交／完成handoff；R1/D08完整角色交接證據按原fingerprint保留。

## Schema、case coverage及限制

無schema／migration／RPC／grants／RLS變更。Manifest digest `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86`；[manifest](../../supabase/release-manifest.json)、[既有diff](schema-diff.json)、[本輪readonly catalog](D12-schema-observation.json)。現有67個history rows包含 [R1最後forward修復](pending-forward-replay.json)，並非D12新增migration。沒有正式庫查詢或真實membership修改。

Docker啟動時停止，gate在client/setup之前拒絕；完整ID/image/network/loopback核實後，只顯式恢復既有owned DB/API。[恢復證據](D12-target-resume.json)。Fixture全部 [exact IDs保留](D12-fixture-retention.json)，沒有reset、廣泛delete或cleanup。第一次API測試把外workspace預期為403，但實際沿用404隱藏資源；只修測試預期，沒有移除權限。兩次browser attempt在SPA pending時誤選首頁重複連結，最終等候實際任務頁heading，沒有force-click或延長timeout；其他導航URL測試亦保留ws query。失敗分類及logs均保留。

UC-A17／UC-A48、N02通過local/disposable。UC-A55與F27完成D12任務作者範圍；D15其他表單仍開放。原107cases／28findings與全部原CSV欄位、originalAuditResult均對照ZIP及prior交付保留，只更新newResult等新增欄位。未測production／CI／部署、Safari/WebKit、實體手機、全站accessibility／200%zoom、load/performance與作者並行編輯認證；付費provider、真實通知／邀請／社交發布及付款均未執行。早前D08/D09未確立根因的觀察仍保留，沒有宣稱已修復。

## Changed files及 rollback

本輪17個code/test/script差異：[獨立D12 patch](D12-changes.patch)，[完整dirty inventory](changed-files.json)。目前fingerprint `879169bdea26e901bb3151971d2ad9b1ede7603d8ee71a535db31388cc1ad412`；上一輪 `23176b626e0d34ec86ab433c4e3d97df4c616f75932c1ecc7dfda2dd5c1f4dbd`，見 [checkpoint](D12-prior-code-fingerprint.json)。

- `e2e/operator-authoring.spec.ts`
- `scripts/audit/run-authoring.mjs`
- `scripts/audit/run-integration.mjs`
- `server/routes/adminMissions.ts`
- `server/test/audit-mission-authoring-contract.test.ts`
- `server/test/audit-mission-authoring.test.ts`
- `src/components/active-mission/PublicationInstructions.tsx`
- `src/components/admin/MissionEditor.tsx`
- `src/components/admin/ProofPolicyFields.test.tsx`
- `src/components/admin/ProofPolicyFields.tsx`
- `src/components/admin/useMissionEditorNavigation.ts`
- `src/lib/i18n.dict.ts`
- `src/lib/missionWorkflowAuthoring.ts`
- `src/routes/-admin.missions.editor.test.tsx`
- `src/routes/-admin.missions.manage.test.tsx`
- `src/routes/admin.missions.$missionId.tsx`
- `src/routes/admin.missions.new.tsx`

## Rollback

未部署，無遠端rollback。以D12 patch及保留的D09 checkpoint逐hunk反轉本輪差異；保留R0/R1/D08/D09既有dirty內容、forward migrations、會員gate及reward engine。新增檔案只限本輪清單，禁止整個worktree reset。沒有schema反向migration；保留合成exact IDs與歷史，不跑seed/reset或廣泛delete。還原後重跑authoring／受影響契約、type-check、build及必要disposable flow。

下一項D13：登入、onboarding及社交帳戶projection。本輪沒有開始D13。
