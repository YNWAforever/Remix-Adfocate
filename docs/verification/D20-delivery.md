# D20 離線交付

狀態：OFFLINE_IMPLEMENTED_MOCK_VERIFIED_LIVE_DISABLED。未部署；沒有 commit、push、merge、正式 membership／角色修改或付費 AI 呼叫。

沿用 `codex/adfocate-r1-pilot-20261023`、HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`；執行介面 turn_context 核實 gpt-6.1-sol，未切換模型。23 個 task-only source/test/harness 檔案，330 個 source records；fingerprint `544f5a717aa6550e1dad0acdb3c69041c8530f25f6dd1ed05ca43a847779aa7b`。完整清單及 rollback patch：D20-delivery.json / D20-changes.patch。 source、文件與證據的完整變更路徑見 D20-changed-files.json。

| 層次 | 本輪結果 |
|---|---|
| Code | 延伸既有 assistant；逐 ID／workspace／creator／staff capability 授權；白名單來源、版本、目前批准標記、限制；嵌入式按需清單及只讀 mock 摘要 |
| Test | 88 targeted；1931 full pass／363 明確環境 gate skip／272 files；原16＋194綠；6 Edge mock；typecheck、harness typecheck、lint、manifest、Node22 build通過 |
| Deployment | not-deployed；protected digest／expiry未生成，canDeploy/canEnablePilot=false |
| Runtime | 只限離線 fake DB/provider 與 Edge transport mock，沒有 real Auth/RLS/provider/財務 E2E |

24 固定案例分 N04–N09 各4組：規則、版本差異、未知／過時、跨scope、注入、故障。Scope/tools邊界8/8、未知／過時處理4/4、故障4/4、mock answer-handling rubric8/8；這些是程式／mock 結果，**不是真實模型答案 rubric≥90% 的證明**。真實品質、tokens、latency及provider驗收全部 NOT_RUN，provider保持disabled。

新入口沒有保存聲稱：回覆明示 not_saved、mock、人手核對。409／未知結果不自動重送；429明確重試沿用 request ID；原有輸入保留。既有D16一般聊天的持久化／quota不變。日後啟用真實operator generation前，仍須把staff與context binding納入既有durable request/quota/crash recovery規格及驗證，不以記憶體去重或mock冒充持久化。

Schema manifest42項、587 declared capabilities及所有既有SQL bytes不變；584 effective capabilities是D19歷史觀察，本輪沒有查庫。見D20-schema-diff.json。沒有新增ledger、可提現額、預算扣減或付款功能；新scope的mutation/tool spies=0。D19完整legacy/active角色交接與pending/cancel/reapproval數值neutrality原檔保留，未當作本輪真實E2E重跑。

D15 BLOCKED_CONTENT_NOT_PROVIDED、UC-C18／UC-A51原本四堂真實課程驗收保持open；正式staff owner grants/bootstrap/cutover仍未獲准。107原audit案例記錄不改寫；本輪只更新N04–N09的新結果。4個原有hook warnings及原有route warning保留。手機390與桌面1280的Edge mock畫面、來源／舊版／輸入恢復已檢查；沒有Safari、實機、完整可存取性或production效能認證。

測試命令、counts及log清單：D20-gate-exits.json / D20-test-results.json；case coverage：D20-case-coverage.json；mock browser：D20-mock-browser-summary.json。所有red/runner/中斷記錄分開保存，不算PASS。原始稽核CSV欄位、originalAuditResult及舊證據不覆寫。

Rollback：Keep the new provider/UI flags off. Review D20-changes.patch and reverse only this task after the recorded reverse check; preserve all earlier dirty work and all evidence. No schema or data rollback is needed. Do not reset to HEAD, clean the worktree, change grants or rewrite migration history. Regenerate the source fingerprint and rerun relevant gates after any rollback.

下一項D任務：D15，等待核准教材。D20真實provider／R3啟用須另行明確授權及上述durable staff gate；本計劃沒有D21。完整23檔案：

- `e2e/fixtures/mission-assist.html`
- `e2e/fixtures/mission-assist.tsx`
- `e2e/mission-assist.spec.ts`
- `playwright.assistant.config.ts`
- `scripts/audit/serve-assistant.ts`
- `server/lib/assistant/chat.ts`
- `server/lib/assistant/contextPolicy.test.ts`
- `server/lib/assistant/contextPolicy.ts`
- `server/lib/assistant/prompt.ts`
- `server/lib/assistant/retrieve.ts`
- `server/lib/staffCapabilities.ts`
- `server/routes/admin.ts`
- `server/routes/assistant.ts`
- `server/test/mission-assist.test.ts`
- `src/components/active-mission/DraftEditor.tsx`
- `src/components/admin/ActiveMissionReview.tsx`
- `src/components/assistant/MissionAssistLauncher.tsx`
- `src/components/assistant/MissionAssistPanel.test.tsx`
- `src/components/assistant/MissionAssistPanel.tsx`
- `src/lib/missionAssist.ts`
- `src/routes/_app.my.$submissionId.tsx`
- `src/routes/admin.active-missions.$workflowId.tsx`
- `tests/fixtures/assistant-workflow-eval.json`
