# D09 交付紀錄

D09 已完成 local 與 disposable 驗證；未部署。沿用 `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`；沒有 commit、push 或 merge。

任務列表、配對及 onboarding recommendations 共用明確 projection／品牌 serializer，卡片、首頁及詳情沿用既有資格規則。現金 null 顯示「未提供」，0 顯示 HK$0.00；門檻、平台、交付、投入、品牌、截止及名額由同一 DTO 提供，沒有逐卡 detail 請求。寵物／旅遊及明確歷史 alias 共用分類來源；未列明 alias 的未知原值仍可篩選，作者表單保留其原值。低 XP 與高等級未驗證帳號提示分開，與真實 join 409 gate 一致。360px 詳情不再截斷重要獎勵資訊。

## 四層結果

| code | test | deployment | runtime |
| --- | --- | --- | --- |
| 已實作並完成順序作者 self-review | 90 targeted、131 consumers；full 1686 pass / 318 skip；16 audit及194既有契約全綠 | 未部署 | 6 D09 API + 35 affected existing integration；1 完整 Edge E2E；真實 disposable Auth/API/PostgREST |

命令、counts及 logs 見 [D09 JSON](D09-delivery.json)。Node22 native emitted ESM、type-check、lint、build、manifest及 diff-check 通過。既有4項 lint warnings、route exports及 bundle size warnings 保留。318個 skips 不當成通過，41項本輪必要 real integration獨立列出；不宣稱所有歷史 R1 integration重跑。初次full suite為1685 pass／1 fail／318 skip：舊測試要求隱藏缺少的現金／平台欄位，現按D09新規格改成明示未知，保留缺少配對理由時不顯示的assertion，另加不默認0及未知資格assertions。該項與Card contract合共19/19重跑通過；最終完整suite重新執行。

## E2E 與持久化證據

最終 fixture `4050e434-7dbf-4990-a3bc-8038aef35a49`；兩個真實 Creator Auth context，360px及1280px。真實 serialized list/detail逐欄相等；known-zero／unknown-cash、寵物／旅遊／historical alias／長中文未知分類、503可讀錯誤與保留選擇後重試、無逐卡 detail requests、低 XP join拒絕及硬刷新、高等級未驗證依然 locked，均通過。[流程](D09-browser-roundtrip.json)、[API](D09-api-contract.json)、[瀏覽器摘要](D09-browser-summary.json)。正向資料沒有用 fake；只注入503負向 transport。UI403快取隱藏另由 route contract測試覆蓋。

360px 真實 RED 顯示兩行截斷隱藏「Cash reward: Not provided」，[修正前](D09-unknown-cash-detail-360-red.png)／[修正後](D09-unknown-cash-detail-360.png)及 scrollHeight assertion保留。兩次 document navigation ERR_ABORTED根因未確立，沒有改產品 Auth；之後3次測試定位錯誤（hidden mobile link、desktop名稱及重複名稱）保留 log。最終按實際主導航可存取範圍操作，詳情仍有明確 hard reload。沒有 force-click、timeout延長或降低 persistence assertions。[完整嘗試分類](D09-delivery.json)。

## Neutrality 及歷史更正

前後 XP=10、points=50、withdrawable=0、cash/point/budget ledger=0、redemptions=0、budget=null、inventory=[]完全相同。[SQL快照](D09-browser-neutrality.json)。D09 獨立查證既有成功 `join_mission` 會增加10 XP；該合成 join設於 measured reads／拒絕加入之前，原始 setup快照保留，沒有重寫餘額。先前 D08文字把0→10歸因 welcome XP的來源未確立；本紀錄追加更正，保留所有歷史 audit／原始快照。沒有新增 ledger、可提現額、扣預算或付款能力。D09 沒有重跑整個 operator handoff；既有 R1／D08完整角色交接及 pending reward歷史證據保留。

## Schema、coverage 與限制

D09無 schema／RPC／grants／RLS／migration變更。Manifest digest `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86`；[既有schema diff](schema-diff.json)、[manifest](../../supabase/release-manifest.json)、[本輪readonly catalog](D09-schema-observation.json)。cash／effort／deadline／category可null，其他上述核心欄位的 NOT NULL約束保留。沒有正式庫查詢或真實membership修改，沒有reset、db push或舊checksum修改。隔離fixture建立本輪合成角色及membership以驗證scope。

UC-C07／UC-C08 local與disposable通過；UC-A17只完成 DTO／category支援，D12的完整作者校驗及預覽仍開放。原107cases／28findings及原CSV每個欄位核對 ZIP全部保留，只追加newResult等欄位。Container/project/image/network/loopback在 client／setup之前核實；合成fixture保留 exact IDs，沒有廣泛清理。

未測：production／CI／部署、Safari/WebKit、實體手機、全站 accessibility、load/p95、真實外部 provider及七日 pilot。本輪integration／browser封鎖外部 HTTP及清空付費provider credentials；沒有真實通知、邀請、發布或付款。先前 D08 intermittent完成對話框問題仍按歷史紀錄保留。

## Changed files

本輪相對 [D08 checkpoint](D09-prior-code-fingerprint.json)有36個 code/test/script檔案差異；完整保留 dirty worktree見 [inventory](changed-files.json)。目前 fingerprint `23176b626e0d34ec86ab433c4e3d97df4c616f75932c1ecc7dfda2dd5c1f4dbd`，上一輪 `51f635f49b22960943af450c65d924ebae5b0aca4d8795a2c3cfae1c36a89dbb`。

- `e2e/mission-discovery.spec.ts`
- `scripts/audit/run-discovery.mjs`
- `scripts/audit/run-integration.mjs`
- `server/lib/missionDecision.ts`
- `server/lib/missionMatch.test.ts`
- `server/lib/missionMatch.ts`
- `server/routes/match.ts`
- `server/routes/missions.ts`
- `server/routes/onboarding.ts`
- `server/test/audit-mission-list-contract.test.ts`
- `server/test/audit-mission-list-projection.test.ts`
- `src/components/-MissionFacts.test.tsx`
- `src/components/MissionCard.contract.test.tsx`
- `src/components/MissionCard.tsx`
- `src/components/MissionCommitmentSummary.test.tsx`
- `src/components/MissionCommitmentSummary.tsx`
- `src/components/MissionFacts.tsx`
- `src/components/RequestFeedback.tsx`
- `src/components/admin/MissionEditor.tsx`
- `src/components/components.test.tsx`
- `src/components/onboarding/OnboardingSteps.tsx`
- `src/lib/creatorFormatting.ts`
- `src/lib/i18n.dict.ts`
- `src/lib/labels.ts`
- `src/lib/missionCategories.test.ts`
- `src/lib/missionCategories.ts`
- `src/lib/missionMeta.ts`
- `src/lib/queries/kocmax.ts`
- `src/routes/-_app.match.test.tsx`
- `src/routes/-_app.mission.index.test.tsx`
- `src/routes/-admin.missions.editor.test.tsx`
- `src/routes/_app.home.tsx`
- `src/routes/_app.match.tsx`
- `src/routes/_app.mission.$missionSlug.tsx`
- `src/routes/_app.mission.index.tsx`
- `src/routes/_app.onboarding.tsx`

## Rollback

未部署，沒有遠端rollback動作。只逐檔反轉D09 projection／consumer／category／eligibility適配及相關測試／runner，使用D09 prior fingerprint與本次diff核對；保留D08及R1既有dirty內容、forward migrations、membership gate及reward engine，避免整個worktree reset。保留 exact fixture IDs與歷史；不跑seed/reset或廣泛delete。反轉後重跑 affected contracts、完整suite、type-check、build及必要disposable flow。

下一項 D12：作者表單的交付要求、校驗與預覽。本輪沒有開始D12。
