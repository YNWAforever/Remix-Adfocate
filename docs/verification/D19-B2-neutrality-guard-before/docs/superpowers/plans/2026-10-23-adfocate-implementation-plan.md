# Adfocate Product Development Implementation Plan

日期：2026-10-23（香港時間）。交給Codex GPT‑6.1 Sol的產品開發計劃；未實作。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

本交接建議採 **native／executing-plans**，由使用者指定的 Codex GPT‑6.1 Sol 逐任務處理；只有另有授權才使用平行agents。模型名稱由執行環境選擇及核實，本文件不會自動切換模型。

**Goal:** Creator與營運可可靠完成一次任務交付、審批、proof及待財務處理交接，然後提升日常工作效率。

**Architecture:** 延伸現有workflow/state、TanStack queries、Hono routes、Supabase RPC與release foundation。保持legacy與active工作模式；共享狀態projection、workspace授權及持久化結果，不另建平行工作流。

**Tech Stack:** React 19、TypeScript、Vite、Tailwind、TanStack Router/Query、Hono、Supabase/Postgres、Vitest；沿用鎖檔。新增browser runner僅在現有環境沒有可重用runner時加入。

**Spec:** `docs/superpowers/specs/2026-10-23-adfocate-product-design.md`。

## Global Constraints

- 稽核基線：`7cfa3dc84c821719a4dff754229a591c81786c53`；執行前比對最新HEAD及AGENTS.md，不把此SHA誤當目前HEAD。
- 香港時間：`Asia/Hong_Kong`；幣別顯示：`HKD`；point、XP、cash不得互相混用。
- `reward_pending`只表示待財務處理；不包含issuance、ledger credit、payout、withdrawal或budget debit。
- 現有`brand_users.user_id`主鍵代表每人一個workspace；本輪不修改為多workspace模型。
- production授權、schema及migration history分別核實；沒有active membership不能自動升權。
- Node22為既有release runbook基準；另驗證Vercel Node24.x相容，不能無聲更換production設定。
- 既有source paths以下皆相對repo；新增路徑明確標示，實作前查重並沿用最新等價模組。
- 不改舊migration checksum、不清空正式庫、不取消測試expiry或permission gate。
- 本文件是規劃交付；local實作／isolated write／push／deploy均以當次使用者授權為準。

## Review Focus

1. API讀取成功但refetch失敗：舊工作保留並標示未更新，不變空清單；D04覆蓋。
2. transport timeout發生在DB commit之後：重送回同一結果；D06/D07/D16覆蓋。
3. detail返回時workspace變更或session撤銷：不顯示前scope的cache；D03/D10/D18覆蓋。
4. 同香港日期跨UTC午夜／null或無效時間：標籤及排序各依正確規則；D11覆蓋。
5. 舊資料、未知policy key與缺歷史contract：保留原值、顯示限制、不編造承諾；D02/D05/D07/D12覆蓋。

## 每項任務的工作單位

每項任務都是一個可獨立review的交付單位。循環為：固定失敗情境 → 最小改動 → 對應驗證 → 保存證據 → 小範圍review／commit。下列test assertions是驗收規格，並非聲稱測試檔已在repo存在。新增檔案與suite必須加入適當runner；不以單獨跑mock代替DB/API integration。

Git操作先核對使用者當次授權；本次規劃本身不執行commit。若允許local commit，按D編號小批提交，清楚列出差異及測試；不要自動push或合併。

## 建議執行順序

1. **R0：D01。** 讀最新基線及稽核包，保留現有修復，建立可比較證據。
2. **R1：D02–D07、D10、D11、D16。** 先schema、scope、假空白、URL及原子性，再把既有workflow跑通；分頁、HK時間及既有AI保存也在本階段修復，以令16項稽核驗收全部轉綠。
3. **D19內部pilot gate。** 只判斷已完成R1及單workspace內部範圍；不是整個網站已可對外放行。
4. **R2：D08、D09、D12、D13、D14、D17、D18。** 提升工作首頁、任務決策、作者表單、登入/社交、誠實內容、品質及角色分工，再以D19進行擴大發布gate。
5. **R3：D15、D20。** 有實際教材及AI評估後獨立上線；不影響核心修復完成。

上述是依賴順序，不是日曆承諾。S約一個小PR，M通常1–2個可review PR，L需拆成相容schema/API/UI或驗收PR；由D01環境與現況決定實際人日。不要為了一張總PR等待全部功能，也不要把schema readiness不足當前端測試通過。

分拆PR建議：foundation／workspace-scope／query-errors／legacy-evidence／crm-transaction／workflow-acceptance／queue-navigation／creator-work-home／authoring-social／quality／assistant。每個PR描述包含問題、變更、使用者結果及證據。

## 共用契約及明確設計決定

| 項目 | 決定 | Owner |
|---|---|---|
| Workspace | API驗證staff、active membership及resource workspace；selector不是權限邊界 | D03 |
| Request errors | UI區分auth/forbidden/validation/conflict/unavailable；不丟舊資料或輸入 | D04 |
| Review commands | requestId＋expectedRevision；同key同payload重放，同key異payload409 | D06 |
| Queue | pageSize25、穩定排序、URL保存搜尋與篩選；DB分頁 | D10 |
| 日期 | timestamp判逾期；workspace時區判日曆日 | D11 |
| Next action | 復用既有deriveNextAction與canonical workflow，不另造boolean狀態 | D07/D08 |
| Proof | URL有效、可讀、平台符合、內容符合是不同判斷；未知不能冒稱通過 | D05/D07 |
| Financial handoff | contract快照不可變；pending/cancel前後財務數值不變 | D07 |
| AI | requestId、權限context、持久化狀態、共享quota；未知provider outcome不可自動再計費 | D16/D20 |

### 代表性可執行驗收斷言

以下是新tests應保留的核心語義；fixture helper由對應任務建立，並非可直接貼入未配置環境的完整測試：

```ts
expect(renderMyMissions({ error: unavailable }).hasEmptyMessage).toBe(false); // D04
expect(validateSubmissionEvidence(['wwww']).ok).toBe(false);                // D05
expect(await replaySameReviewCommand()).toEqual(firstReceipt);             // D06
expect(afterHandoff.neutralitySnapshot).toEqual(beforeHandoff);             // D07
expect(page2.ids).toContain(creator26.id);                                  // D10
expect(dueLabel('2026-10-23T03:00:00Z', new Date('2026-10-22T23:30:00Z'), 'Asia/Hong_Kong')).toBe('today'); // D11
expect(assistantResponse.persistence).not.toBe('saved'); // DB save failed   // D16
```

## 任務清單

### D01 · 確認基線、保留回歸測試及固定release測試時鐘

**階段：** R0　**依賴：** 無　**規模：** S　**狀態：** not-started

**對應：** F17；案例 UC-R01, UC-R02。

**Files：**

- 修改 scripts/release/pilot.test.ts
- 閱讀 scripts/release/pilot.ts、.github/workflows/ci.yml、package.json、docs/operations/production-release-foundation.md
- 加入 src/audit-tests/ 下稽核包7個測試檔（先比較，不覆蓋同名新工作）
- 新增 docs/verification/2026-10-23-adfocate-baseline.md

**Interfaces（新增者為本計劃設計）：** 保留production expiry演算法。測試使用vi.useFakeTimers()/vi.setSystemTime固定now，afterEach還原；基線記錄{repo,branch,baseSha,headSha,dirtyFingerprint,nodeVersion,packageLockHash,auditArchiveHash}。

- [ ] **1. 固定失敗情境及assertions。** pilot測試：approved且未過期可通過；同一證據過期必拒絕；race情境仍測race。16個稽核測試先原樣跑並逐一比較，不預設最新HEAD一定16 fail。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 確認remote及AGENTS.md；如有既有工作在合適worktree續做，不reset。比較baseline到HEAD的相關commit及既有pilot-clock分支；只採用已review必要diff。先檢查資源，再安裝lockfile依賴與跑對應測試。記錄Node22與production Node24.x差異。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run scripts/release/pilot.test.ts
TZ=Asia/Hong_Kong npx vitest run src/audit-tests --maxWorkers=2 --minWorkers=1
npm run type-check
```

- [ ] **5. 核對完成條件並交接。** 有可重現現況記錄；clock測試不再取決於2026-10-23；沒有取消expiry、跳過失敗或假稱production已修。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D02 · 修復schema相容性及隔離重演

**階段：** R1　**依賴：** D01　**規模：** L　**狀態：** not-started

**對應：** F01, F20；案例 UC-R03, UC-R04。

**Files：**

- 閱讀 supabase/release-manifest.json、supabase/migrations/、scripts/release/{manifest,preflight,rehearsal,target-guard}.ts
- 閱讀 docs/operations/{production-release-foundation,reward-handoff}.md
- 新增經差異核對後的forward migrations及對應manifest entry；時間戳在實作時唯一生成
- 新增 server/test/audit-schema-compatibility.test.ts

**Interfaces（新增者為本計劃設計）：** 沿用現有manifest的capabilities、dependsOn、transactionExpectation及replayExpectation。產出schema-diff.json：每個object為present-compatible/present-different/missing/history-only；另有RPC signatures、grants及RLS摘要。不能預先硬寫未知production差異。

- [ ] **1. 固定失敗情境及assertions。** 空隔離庫及production-shaped隔離庫都可重演；舊legacy submission仍可讀；所有required workflow/reward tables、columns、FK、RPC及授權存在；同一replay策略第二次不造成資料損毀；新client建立前target guard拒絕host/proxy/container矛盾。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 先唯讀盤點，採additive/forward repair。每個已存在但history不一致object先證明兼容才處理migration記錄；不得直接mark-all-applied。後續CRM/AI/角色/課程migration若超出現有manifest的三個phase，須在相應任務擴充contracts/manifest及兼容測試，不得把新migration省略或假列為reward_handoff。維持舊workflow模式，沒有歷史證據不得填造reward contract。檢視advisor grants/search_path，不為消警告放寬policy。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npm run release:manifest:check
npm run release:rehearse  # 僅兩個已核實並獲授權的隔離目標
npm run test:integration  # 先檢查runner/setup副作用及target identity
```

- [ ] **5. 核對完成條件並交接。** 兩個schema rehearsal均有證據；必要integration不skipped；正式migration僅準備具體changeset，未獲授權不執行。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D03 · 統一staff／workspace權限與可恢復登入狀態

**階段：** R1　**依賴：** D01, D02　**規模：** L　**狀態：** not-started

**對應：** F15, F16, F25；案例 UC-A01, UC-A02, UC-A03, UC-A23, UC-A24, UC-A27, UC-A30, UC-A34, UC-A35, UC-A38, UC-A42, UC-A43。

**Files：**

- 修改 server/lib/staffAuth.ts、server/routes/admin.ts、server/routes/adminMissions.ts、server/routes/adminOperatorCrm.ts
- 修改 server/routes/adminActiveMissions.ts、server/lib/activeMission/rewardHandoff.ts（保留原有membership防護）
- 修改 src/components/admin/{StaffAuthGate,WorkspaceSwitcher}.tsx、src/routes/{admin,operator}.tsx
- 新增 server/lib/staffWorkspace.ts、server/lib/staffWorkspace.test.ts；新增 server/test/audit-admin-scope.test.ts

**Interfaces（新增者為本計劃設計）：** 新增requireStaffWorkspace(client: SupabaseClient, staff: StaffIdentity, workspaceSlug: string): Promise<AuthorizedWorkspace>；StaffIdentity={userId:string,active:boolean,viaSecret:boolean}，AuthorizedWorkspace={workspaceId:string,workspaceSlug:string,userId:string}。只由verified JWT建立staff；resource lookup再比對workspace。入口狀態使用loading/unauthenticated/forbidden/unavailable/authorized。

- [ ] **1. 固定失敗情境及assertions。** UC-A27/A30：workspace lookup失敗有alert/retry；503不能變登入。staff active＋membership active可讀；無membership、disabled、另一workspace ID及shared-secret sentinel均拒絕。清單All只回authorized scopes；切workspace不殘留另一scope資料。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 先列每個admin資源的workspace-owned或platform-global性質；把legacy CRM及審批從可任意filter轉成server scope enforcement。academy_content沒有workspace_id，保留平台內容定位及R1 staff gate，不盲目加workspace條件；D18另收緊平台編輯權限。保留resource不存在與越權的非枚舉回應。返回可用功能及明確權限提示，不讀出secret。關閉interactive domain auto-enrol及secret回退的實際銜接方式寫入runbook，正式舊staff grant必須由owner核准。UI不提供自動提升權限捷徑。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/audit-tests/staff-unavailable.audit.test.tsx src/audit-tests/operator-continuation.audit.test.tsx
npx vitest run server/lib/staffWorkspace.test.ts
npm run test:integration  # 必含audit-admin-scope，加入runner白名單後執行
```

- [ ] **5. 核對完成條件並交接。** 401/403/503分開且可恢復；缺membership不再被解讀為登入失敗；legacy與新workflow都能在API層拒絕跨scope；global Academy不冒稱workspace隔離。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D04 · 修復假空白及清單／審批錯誤回饋

**階段：** R1　**依賴：** D01　**規模：** M　**狀態：** not-started

**對應：** F02, F03, F05, F06；案例 UC-C03, UC-C04, UC-C05, UC-C06, UC-C09, UC-A05, UC-A06, UC-A25, UC-A47, UC-A53。

**Files：**

- 修改 src/routes/_app.my.index.tsx、src/routes/_app.mission.$missionSlug.tsx、src/components/EarningsSummaryCard.tsx；修復錢包CTA及舊路由兼容
- 修改 src/routes/admin.{creators,applications,submissions}.tsx、src/routes/admin.missions.index.tsx
- 修改 src/components/operator/ReviewActionPanel.tsx
- 新增 src/components/RequestState.tsx、src/lib/requestError.ts及其tests

**Interfaces（新增者為本計劃設計）：** 新增toRequestError(error:unknown): {kind:"auth"|"forbidden"|"validation"|"conflict"|"unavailable";messageKey:string;retryable:boolean}。RequestState只負責呈現query狀態；各mutation仍按自己的query key失效。未知membership或mission status不輸出Join CTA。

- [ ] **1. 固定失敗情境及assertions。** UC-C04/C05/C06、A05/A06/A25/A53轉綠；首頁錢包CTA與硬重載均到有效頁。參數化覆蓋現有全部SubmissionStatus；API500不出現尚未加入；成功空陣列才顯示空；refetch失敗保留舊卡片＋未更新；mutation錯誤保留note/row；retry成功後移除error。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 先處理error再處理data fallback。用role=alert及與輸入綁定的錯誤，不只toast。409顯示最新版本及重新載入；未確認狀態不自動重送有副作用mutation。不同任務mode保留原有入口。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/audit-tests/my-missions.audit.test.tsx src/audit-tests/admin-creators.audit.test.tsx src/audit-tests/admin-decisions.audit.test.tsx src/audit-tests/admin-live-followup.audit.test.tsx
npm run type-check
```

- [ ] **5. 核對完成條件並交接。** 指定錯誤案例通過；此時分頁或無效證據等其他未修驗收仍可能fail，逐項記錄而非宣稱整檔已綠。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D05 · 對legacy作品輸入及批准加證據有效性防護

**階段：** R1　**依賴：** D02, D03　**規模：** M　**狀態：** not-started

**對應：** F26；案例 UC-A44, UC-A54。

**Files：**

- 修改 src/routes/_app.mission.$missionSlug.tsx、src/routes/admin.submissions.tsx
- 修改 server/routes/missions.ts、server/routes/admin.ts及對應legacy RPC forward migration
- 新增 src/lib/submissionEvidence.ts、src/lib/submissionEvidence.test.ts
- 新增 server/test/audit-legacy-evidence.test.ts；閱讀 server/lib/activeMission/proofUrl.ts

**Interfaces（新增者為本計劃設計）：** 新增validateSubmissionEvidence(urls:readonly string[]): {ok:true;urls:string[]}|{ok:false;issues:{index:number;code:"empty"|"invalid_url"|"unsupported_scheme"|"credentials_not_allowed"}[]}。全數有效才接受，trim/dedupe但不自動把wwww補成URL；http/https絕對URL、非空host、無embedded credentials。

- [ ] **1. 固定失敗情境及assertions。** UC-A54：wwww不能普通批准且不render成link；API及直接legacy RPC都拒絕空/相對/非HTTP(S)值；混合有效無效不得部分成功；合法URL可提交；批准前再核對存量資料。network metadata不可讀表示未知，不自動斷言作品不合格。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 共享格式validator及server入參檢查，DB防止直接RPC寫入基本不合法值；批准路徑獨立驗證stored evidence。提供要求修正而保留歷史的操作。沿用active proof的DNS/redirect/timeout防護；本地validator不fetch任意URL。平台業務驗證與URL格式分開。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/lib/submissionEvidence.test.ts src/audit-tests/admin-live-followup.audit.test.tsx
npm run test:integration  # 加入audit-legacy-evidence套件
```

- [ ] **5. 核對完成條件並交接。** 無效舊記錄只可進修正處理；有效legacy submission仍正常批准且獎勵只記一次；沒有誤把enabled按鈕當成既有實際發獎證據。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D06 · CRM決策、備註與audit原子提交及重送去重

**階段：** R1　**依賴：** D02, D03　**規模：** L　**狀態：** not-started

**對應：** F21, F23；案例 UC-A08, UC-A26, UC-A31, UC-A32。

**Files：**

- 修改 server/lib/operatorCrm/{repo,types,serializers}.ts、server/routes/adminOperatorCrm.ts
- 修改 src/lib/admin.ts、src/components/operator/ReviewActionPanel.tsx
- 新增 CRM command receipt/revision forward migration（時間戳唯一）
- 新增 server/test/audit-crm-commands.test.ts

**Interfaces（新增者為本計劃設計）：** ReviewCommand={requestId:string;expectedRevision:number;creatorId:string;status:CreatorReviewStatus;riskLevel:CreatorRiskLevel;summary:string|null;note:string|null}；actor及workspace來自AuthorizedWorkspace，不信任body。DB RPC apply_creator_review_command及add_creator_review_note_command回{revision,receiptId,review,noteId}。requestId以actor＋workspace限定，存canonical payload hash及result。

- [ ] **1. 固定失敗情境及assertions。** UC-A26/A31/A32：Flag先收集非空具體理由；取消0 mutation。review/note/audit任一故障全回滾；相同key與payload回同result；同key不同payload409；舊revision409；兩operator只有一個合法版本。以真實隔離Postgres驗證commit，不只mock。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** RPC一個transaction包含scope、revision、idempotency、review、note及audit；無note時不造note。前端保留同一requestId跨ambiguous retry；明確衝突後重載再生成新邏輯操作。原稽核fake可改transport adapter以配合RPC，保留原子性／去重斷言。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/audit-tests/crm-atomicity.audit.test.ts src/audit-tests/operator-continuation.audit.test.tsx
npm run test:integration  # 加入audit-crm-commands套件
```

- [ ] **5. 核對完成條件並交接。** UI與資料庫可證明同一個結果；失敗不留下部分狀態；備註不外洩至一般telemetry。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D07 · 把既有active交付／proof／reward流程跑通

**階段：** R1　**依賴：** D02, D03, D04, D05, D06　**規模：** L　**狀態：** not-started

**對應：** 完整旅程／新產品要求；案例 UC-C24, UC-C25, UC-C26, UC-C27, UC-C28, UC-C29, UC-C30, UC-C31, UC-C32, UC-A10, UC-A11, UC-A12, UC-A13, UC-A14, UC-A15, UC-A16, UC-A36, UC-A37, UC-S01。

**Files：**

- 核對 server/lib/activeMission/{state,creatorActions,publicationProof,rewardHandoff}.ts
- 核對 src/lib/queries/activeMission.ts、src/components/admin/{ActiveMissionReview,PublicationProofReview,MissionCompletionReview,RewardHandoffQueue}.tsx
- 按缺陷最小修改上述既有檔案；不重建狀態機
- 新增 e2e/creator-operator-mission.spec.ts、server/test/audit-workflow-roundtrip.test.ts；若無runner，新增playwright.config.ts並以package.json/package-lock.json鎖定@playwright/test，禁止命令臨時下載未知版本

**Interfaces（新增者為本計劃設計）：** 沿用WorkflowState/WorkItemState、revision、idempotency及completion APIs；pending/cancelled handoff是既有終態。整合產出{runId,caseId,submissionId,workflowId,decisionId,pendingRewardId,beforeSnapshot,afterSnapshot}，只存opaque IDs與數值。

- [ ] **1. 固定失敗情境及assertions。** UC-C24–C32、A10–A16、S01：加入最後名額競爭；收貨、保存稿、刷新、修改、重交、批准發布、proof修正、驗證、completion、cancel。optional交付不阻擋required；缺歷史contract阻擋；通知失敗可獨立重試；handoff前後全部neutrality值相等。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 先使用既有release fixtures及integration，再補真實瀏覽器完整角色交接。任何seed腳本先審查廣泛delete；本輪fixture使用唯一run_id及精確IDs。browser suite使用已核准隔離角色，不以mockJWT自稱真實Auth通過。E2E缺credential時保留blocked並繼續其他可做工作。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npm run test:active-missions
npm run test:integration
npx --no-install playwright test e2e/creator-operator-mission.spec.ts  # D01確認可用runner；沒有時先加入鎖定dev dependency及設定
```

- [ ] **5. 核對完成條件並交接。** 同一schema與SHA有完整兩角色持久化證據；付款、ledger credit、budget debit不是此任務成果。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D08 · Creator首頁以當前工作為先並修復導航

**階段：** R2　**依賴：** D04, D07　**規模：** M　**狀態：** verified-local-and-disposable（未部署）

**對應：** F03, F10；案例 新增產品案例，見new_product_acceptance_cases.csv。

**Files：**

- 修改 src/routes/_app.home.tsx、src/components/{ActiveMissionSummary,NextBestActionCard,EarningsSummaryCard,BottomNav}.tsx、src/components/navItems.ts
- 修改 src/lib/useCreatorActivation.ts、src/lib/activeMission.ts僅必要適配
- 新增 src/components/CreatorWorkHome.test.tsx、e2e/creator-navigation.spec.ts

**Interfaces（新增者為本計劃設計）：** 消費既有ActiveMissionWorkspace及deriveNextAction，首頁／詳情共用同一判斷；pendingReward單獨呈現，不能落到draft CTA。手機nav固定5項，更多提供既有剩餘路由。

- [x] **1. 固定失敗情境及assertions。** UC-C03/C04/C09/Q01及新增N01：needs revision直達該workItem；await review無重交/加入CTA；reward_pending不可提現；空與錯誤分開；首頁及硬重載錢包有效；360px可達所有導航。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 調整優先次序而不替換現有activation引擎；任務優先於推薦內容。新增或保留舊wallet link兼容redirect。CTA有明確動詞和目標，不向用戶顯示revision/UUID等工程細節。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/components/CreatorWorkHome.test.tsx src/lib/activeMission.test.ts src/lib/activationAnalytics.test.ts
npx --no-install playwright test e2e/creator-navigation.spec.ts
```

- [x] **5. 核對完成條件並交接。** Creator可在2次主要操作內到正確交付，重載不改任務狀態。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D09 · 任務列表DTO、分類與資格一致

**階段：** R2　**依賴：** D02, D04　**規模：** M　**狀態：** verified-local-and-disposable（未部署）

**對應：** F07, F08；案例 UC-C07, UC-C08。

**Files：**

- 修改 server/routes/missions.ts、src/routes/_app.mission.index.tsx、src/components/MissionCard.tsx
- 修改 src/lib/missionCategories.ts及既有mission DTO消費端
- 新增 server/test/audit-mission-list-contract.test.ts、src/components/MissionCard.contract.test.tsx

**Interfaces（新增者為本計劃設計）：** 在既有DTO增補cash_reward、required_level、platforms、effort、deliverables及現有品牌/截止/名額欄位；null保留未知，不默認0。MISSION_CATEGORIES加入現有寵物/旅遊並給歷史值mapping；authoring/filter同源。

- [x] **1. 固定失敗情境及assertions。** UC-C07/C08、A17：真實API serialized list對比detail，獎勵/門檻/平台/投入一致；現金=0與null分開；所有既有分類可找回；長中文及未知分類不消失。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 明確projection及合約測試，避免用完整mock掩蓋API缺欄位。不要為補卡片資料而每列額外發detail request。已有cash/level/platform欄位不是缺schema的新發現。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/components/MissionCard.contract.test.tsx
npm run test:integration  # 加入audit-mission-list-contract
```

- [x] **5. 核對完成條件並交接。** 列表足以作參與決策，且沒有把未知值顯示成確定承諾。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D10 · Creator queue服務端分頁與詳情返回上下文

**階段：** R1　**依賴：** D03, D04　**規模：** L　**狀態：** not-started

**對應：** F04, F18, F24；案例 UC-A04, UC-A07, UC-A33, UC-A39, UC-A40, UC-A41。

**Files：**

- 修改 server/lib/operatorCrm/repo.ts、server/routes/adminOperatorCrm.ts、src/routes/admin.creators.tsx
- 修改 src/routes/operator.tsx、src/routes/operator.creators.$creatorId.tsx、src/routes/admin.tsx
- 新增 src/components/admin/AdminShell.tsx、src/lib/creatorQueueSearch.ts及其tests
- 新增 server/test/audit-creator-pagination.test.ts、e2e/operator-queue.spec.ts

**Interfaces（新增者為本計劃設計）：** 沿用CreatorQueueFilters及response{creators,total,page,pageSize}。parseCreatorQueueSearch(search)輸出{ws,q,status,risk,sort,page,pageSize:25}；page≥1、q最多200 code points、sort只允許既有4項，非法輸入回安全預設或API400。每個排序加id tie-breaker/nulls last。

- [ ] **1. 固定失敗情境及assertions。** UC-A04/A07/A33/A39/A41：26/51筆可達；大資料total正確；相同排序值不遺漏；快速搜尋舊回應不能覆蓋新結果；進詳情／返回／硬重載保留條件；換workspace清cache；安全returnTo拒絕站外／javascript值。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 在DB完成filter/sort/page與count，禁止fetch-all後slice。300ms debounce＋query取消/結果key隔離。共用shell及breadcrumb；page與filter入URL，焦點與scroll在session導航狀態，敏感草稿不放URL。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/audit-tests/admin-creators.audit.test.tsx src/lib/creatorQueueSearch.test.ts
npm run test:integration  # 加入audit-creator-pagination
npx --no-install playwright test e2e/operator-queue.spec.ts
```

- [ ] **5. 核對完成條件並交接。** 第26人可達；返回不丟搜尋；R2可再優化密度，但功能驗收在R1完成。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D11 · 香港到期標籤與雷達直達工作

**階段：** R1　**依賴：** D03, D04　**規模：** M　**狀態：** not-started

**對應：** F22, F28；案例 UC-A22, UC-A28, UC-A29, UC-A52。

**Files：**

- 修改 src/components/admin/ActiveMissionQueue.tsx、src/routes/admin.radar.tsx
- 新增 src/lib/workspaceCalendar.ts、src/lib/workspaceCalendar.test.ts
- 視路由需要修改 src/routes/admin.submissions.tsx 接收受限submission定位參數
- 新增 e2e/operator-radar.spec.ts

**Interfaces（新增者為本計劃設計）：** calendarDay(iso:string,timezone:string):string|null；dueLabel(dueAt:string|null,now:Date,timezone:string):"overdue"|"today"|"future"|"unknown"。預設Asia/Hong_Kong；逾期比較timestamp，今天比較該時區日期。radar連結帶受server scope保護的submission/workItem ID。

- [ ] **1. 固定失敗情境及assertions。** UC-A28/A29/A22/A52：香港07:30→同日11:00為today；23:30→翌日01:00不為today；null/invalid為unknown；已過時間為overdue。點逾期列到正確個案，失效／無權限有明確回應；不能只到總清單頂部。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** 展示絕對日期及適當時數/日數，保留原timestamp排序。補齊個案定位及返回來源；R1不新造完整dashboard資料倉庫。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/audit-tests/operator-continuation.audit.test.tsx src/lib/workspaceCalendar.test.ts
npx --no-install playwright test e2e/operator-radar.spec.ts
```

- [ ] **5. 核對完成條件並交接。** 兩個HK邊界測試轉綠；雷達下一步可操作，沒有聲稱舊3020小時值已核實。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D12 · 任務作者表單以交付要求及預覽編輯

**階段：** R2　**依賴：** D07, D09　**規模：** M　**狀態：** verified-local-and-disposable（未部署）

**對應：** F27；案例 UC-A17, UC-A48, UC-A55。

**Files：**

- 修改 src/components/admin/MissionEditor.tsx、server/routes/adminMissions.ts
- 新增 src/components/admin/ProofPolicyFields.tsx、src/components/admin/ProofPolicyFields.test.tsx
- 修改 src/lib/i18n.dict.ts；新增 e2e/operator-authoring.spec.ts

**Interfaces（新增者為本計劃設計）：** ProofPolicyFields消費既有proof_evidence_policy及onChange(nextPolicy)，提供已知key的表單adapter；未知key原樣保留並提示進階設定。表單字段直接對應既有template publication_window_hours、required_disclosures、expected_account。

- [x] **1. 固定失敗情境及assertions。** UC-A17/A48/A55及N02：不寫JSON可建立required deliverable；無效JSON／負期限不能保存；未知key roundtrip保留；preview、reload、Creator工作頁一致；保存失敗保留輸入；未保存離開有提示。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 統一繁中label及help text；進階JSON非必經。關聯錯誤定位至具體deliverable。現有發布validation維持server權威；schema不可用時不把空表單保存宣稱成功。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/components/admin/ProofPolicyFields.test.tsx
npx --no-install playwright test e2e/operator-authoring.spec.ts
```

- [x] **5. 核對完成條件並交接。** 非工程operator能建立並預覽一個可執行任務；沒有意外刪除原規則。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D13 · 統一登入、onboarding及社交帳戶projection

**階段：** R2　**依賴：** D03, D04　**規模：** L　**狀態：** verified-local-and-disposable（PKCE UI transport mocked；未部署）

**對應：** F09, F13；案例 UC-C01, UC-C02, UC-C10, UC-C11, UC-C12, UC-C20, UC-C21, UC-C22, UC-C23, UC-C34, UC-C35, UC-S03。

**Files：**

- 修改 src/routes/_app.login.tsx、src/routes/_app.profile.tsx、src/lib/i18n.dict.ts
- 修改 src/components/{SocialTrustPanel,PassportTrustSummary}.tsx、server/lib/social/{repo,service,passportSocial}.ts
- 新增 src/lib/socialAccountPresentation.ts及tests；新增 e2e/creator-identity-profile.spec.ts

**Interfaces（新增者為本計劃設計）：** 新增SocialAccountPresentation={platform,handle,source:"legacy"|"canonical"|"conflict",syncStatus,ownershipVerified,lastSyncedAt}；legacy handle不得使ownershipVerified=true。原API若有多個來源，server回傳可追蹤projection，不在多頁各自猜。

- [x] **1. 固定失敗情境及assertions。** UC-C20–C23/C34/C35/S03：登入錯誤/過期連結與safe return；onboarding中斷可續填及welcome reward唯一；handle衝突不覆寫；profile/Passport重載一致；公開分享只含批准欄位、撤銷後失效。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 對外文案統一Adfocate；同一email步驟選登入方法，保留既有authprovider能力。重設憑證沿用安全認證流程。非必要社交連接不阻擋瀏覽任務；申請資格仍由server獨立核對。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/lib/socialAccountPresentation.test.ts server/lib/social/passportSocial.test.ts
npm run test:integration
npx --no-install playwright test e2e/creator-identity-profile.spec.ts
```

- [x] **5. 核對完成條件並交接。** 用戶可分辨已填、已同步及已驗證；認證操作以隔離帳戶完成並保留未測限制。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D14 · 修正公開承諾及未完成課程顯示

**階段：** R2　**依賴：** D04　**規模：** M　**狀態：** verified-local-and-disposable（truthful-preview scope；原4課驗收待D15；未部署）

**對應：** F11, F12, F14；案例 UC-P01, UC-P02, UC-P03, UC-C18, UC-A20, UC-A50, UC-A51。

**Files：**

- 修改 src/routes/_site.{index,creators,contact}.tsx、src/data/mockData.ts
- 修改 src/routes/_app.guide.track.$trackId.tsx、src/routes/admin.academy.$id.tsx及src/components/admin/AcademyEditor.tsx
- 沿用 src/lib/levels.ts；新增 src/routes/-public-claims.test.tsx

**Interfaces（新增者為本計劃設計）：** LEVELS為唯一XP門檻；contact在preview mode不提交、不持久化、不稱已記錄。academy展示先分有正文／內容準備中；沒有lesson資料不從metadata.duration推論可完成單元數。

- [x] **1. 固定失敗情境及assertions。** UC-P02/P03/C18/A20/A50/A51：以有正文的resource fixture測建立、重載、發布、門檻及篩選；3840XP依canonical計算；無證據靜態統計不冒稱真實成績；preview refresh不誤導成功；空正文課程不顯示可開始4堂課。表單的title/excerpt/body皆有label。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 先採明確preview及內容準備中作產品預設。真實收件接通需owner指定destination再另行啟用；正式課程內容由D15提供。這是公開承諾的明確縮減，發布前須確認，不能靠把舊驗收改字就稱有4堂課。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run src/routes/-public-claims.test.tsx src/lib/levels.test.ts
npx --no-install playwright test e2e/public-claims.spec.ts  # 本任務新增
```

- [x] **5. 核對完成條件並交接。** 所有可見承諾有實際能力或清晰示範標示；沒有擅自寫入正式內容或寄出聯絡訊息。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D15 · 真正的課程單元及持久化進度

**階段：** R3　**依賴：** D13, D14　**規模：** L　**狀態：** implemented-verified-local-synthetic；BLOCKED_CONTENT_NOT_PROVIDED（UC-C18/A51原4課驗收未通過；未部署）

**對應：** F14, F27；案例 新增產品案例，見new_product_acceptance_cases.csv。

**Files：**

- 新增academy_lessons、creator_lesson_progress forward migration；不改舊metadata為假內容
- 修改 server/routes/adminAcademy.ts、src/components/admin/AcademyEditor.tsx、src/routes/_app.guide.track.$trackId.tsx
- 新增 server/routes/academyLessons.ts、src/lib/academyProgress.ts、server/test/audit-academy-progress.test.ts；修改server/app.ts掛載新route
- 新增 e2e/academy-learning.spec.ts

**Interfaces（新增者為本計劃設計）：** Lesson={id,trackId,title,body,position,contentVersion,status}; Progress={creatorId,lessonId,contentVersion,status:"completed",completedAt}，唯一(creatorId,lessonId,contentVersion)。新增受權限API列已發布lesson及標記本人完成；total取實際published lessons。

- [x] **1. 固定失敗情境及assertions。** UC-A20/C18及N03：兩單元合成課程，完成一課後刷新仍1/2；同request重送不重複；另一creator讀不到progress；未達level不可讀locked body；新contentVersion不偷改舊完成紀錄；preview不可見draft給Creator。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 保留既有track頁及內容權限；operator可編輯排序並預覽。沒有核准真實教材時只交付draft功能和synthetic fixtures，不發布生成課程。完成單元不自動新增XP/獎勵，除非另有明確產品規則。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npm run test:integration  # 加入audit-academy-progress
npx --no-install playwright test e2e/academy-learning.spec.ts
```

- [x] **5. 核對完成條件並交接。** 真實學習體驗可保存；正文不足或owner未提供內容時產品發布維持blocked，不虛構課程。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。


**D15 執行補充：** owner 已確認沒有核准教材，保留內容 blocker。原4堂真實課程語義不變；只完成 draft 工具與 N03 合成驗證。以 identity-gated `node scripts/audit/run-integration.mjs academy` 及 `node scripts/audit/run-academy-browser.mjs` 取代廣泛 seed/cleanup 命令；實際 counts/commands 見 docs/verification/D15-delivery.json。未獲 local commit 授權，沒有 commit。

### D16 · 修復現有AI生成、保存及重試可靠性

**階段：** R1　**依賴：** D02, D03, D04　**規模：** L　**狀態：** not-started

**對應：** F19；案例 UC-C19, UC-Q04, UC-Q05。

**Files：**

- 修改 server/routes/assistant.ts、server/lib/assistant/chat.ts、src/lib/queries/kocmax.ts（useAssistantChat）、src/components/assistant/AssistantPanel.tsx
- 新增 server/lib/assistant/requestPolicy.ts及tests；新增assistant request/turn原子保存migration
- 新增 server/test/audit-assistant-persistence.test.ts

**Interfaces（新增者為本計劃設計）：** chat新增client_request_id（UUID）；結果增加persistence:"saved"|"failed"|"unknown"及request_id。request以creator/workspace/requestId唯一，payload hash涵蓋message/locale/contextVersion。建議設定MAX_MESSAGE_CODEPOINTS=4000、NEW_REQUESTS_PER_MINUTE=5、MAX_INFLIGHT=1、PROVIDER_TIMEOUT_MS=30000。

- [ ] **1. 固定失敗情境及assertions。** UC-Q04/Q05：provider成功而DB保存失敗不得顯示已保存；history讀取錯誤明示降級；同request重試不新生成；多instance併發quota原子；4001 code points回400；429保留輸入；跨creator conversation拒絕；provider unknown outcome不自動重叫。
- [ ] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** conversation/turn提交原子化，檢查每個DB error。共享request/quota store而非process計數。LLM timeout後呈現可查詢結果狀態；不能承諾provider跨崩潰exactly-once收費。mock provider不需付費；真實用量驗證另行核准。
- [ ] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run server/lib/assistant/requestPolicy.test.ts server/lib/assistant/chat.test.ts src/components/assistant/AssistantPanel.test.tsx
npm run test:integration  # 加入audit-assistant-persistence，provider全mock
```

- [ ] **5. 核對完成條件並交接。** 生成、保存與使用量各自可追蹤；現有AI不再以成功文字掩蓋未保存。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

### D17 · 效能、可存取性及產品結果量度

**階段：** R2　**依賴：** D08, D09, D10, D11, D12, D13　**規模：** L　**狀態：** implemented-verified-bounded-local（未部署；native zoom／實機／hosted／advisor owner驗收仍open）

**對應：** F10, F18, F20；案例 UC-A21, UC-Q01, UC-Q02, UC-Q03。

**Files：**

- 修改 vite.config.ts及經bundle分析確認的lazy-load邊界；不任意升級framework
- 檢查Admin/Creator主要components的label、focus、empty/error及色彩
- 延伸 src/lib/activationAnalytics.ts、server/lib/activeMission/metrics.ts
- 新增 docs/verification/2026-10-23-adfocate-quality.md、e2e/accessibility.spec.ts

**Interfaces（新增者為本計劃設計）：** 事件以opaque entity ID、action、revision及result為主；成功業務事件從durable結果派生，頁面render不算完成。fingerprint包含網路/裝置/資料量/冷暖快取；advisor disposition記owner、risk及驗證。

- [x] **1. 固定失敗情境及assertions。** UC-Q01/Q02/Q03/A21：360/390/768px、200%zoom、鍵盤dialog回焦點、長姓名/URL、錯誤宣讀。1k/10k queue total正確；API≥100請求及UI≥20次互動；報raw/p50/p95及樣本。insights用已知ledger fixture核對HK區間分母。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 先量再拆包；只對量測瓶頸加index，保留query plan。建議門檻LCP2.5s/INP200ms/CLS0.1/list p95 800ms；未達先說明瓶頸，不能用bundle大小當真實速度。no-policy service-only表不可為消advisor加寬鬆policy。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npm run lint
npm run type-check
npm run build
npx --no-install playwright test e2e/accessibility.spec.ts
npm run test:integration
```

- [x] **5. 核對完成條件並交接。** 測得核心頁品質；已知warning有處置；沒有標示未實測手機或production性能為通過。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。


**D17 執行補充：** 實際 commands/counts/原始樣本及限制見 `docs/verification/D17-delivery.json` 與 `2026-10-23-adfocate-quality.md`。200%為等效CSS reflow模擬，非native browser zoom；5頁axe非全產品認證。以identity-gated `run-integration.mjs quality`及`run-quality.mjs final`取代共享seed/reset integration。463項local notices已有owner角色/risk/validation，尚未有具名owner及hosted acceptance。缺少保存來源的help／operator時長不填0。D15內容blocker保留；沒有commit/push/merge/deploy授權或操作。

### D18 · 營運角色能力分離及安全銜接

**階段：** R2　**依賴：** D03, D06　**規模：** L　**狀態：** implemented-verified-bounded-local（未部署；正式staff owner grant／銜接仍open）

**對應：** F16, F25；案例 UC-S02。

**Files：**

- 新增 server/lib/staffCapabilities.ts及tests、staff_workspace_roles及staff_platform_roles forward migrations
- 修改 admin各寫入route統一requireCapability，保留staff及brand membership檢查
- 修改 AdminTopBar/WorkspaceSwitcher顯示業務可用功能
- 新增 server/test/audit-staff-capabilities.test.ts、docs/operations/staff-access-transition.md

**Interfaces（新增者為本計劃設計）：** StaffWorkspaceRole="workspace_admin"|"operator"|"reviewer"|"finance_viewer"；staff_workspace_roles唯一(user_id,workspace_id)，含active、granted_by、granted_at。StaffCapability為creator.read/creator.review/application.review/submission.review/proof.review/mission.manage/completion.approve/reward.read/reward.settings/access.manage。requireCapability(client:SupabaseClient,scope:AuthorizedWorkspace,capability:StaffCapability):Promise<void>另查此grant；無grant deny。品牌owner/member不自動映射staff角色。另設PlatformRole="content_editor"及staff_platform_roles(user_id,role,active,granted_by,granted_at)，requirePlatformCapability(client:SupabaseClient,staff:StaffIdentity,capability:"content.manage"):Promise<void>處理沒有workspace_id的Academy及global content；workspace_admin不繼承此權限。

- [x] **1. 固定失敗情境及assertions。** UC-S02/A24：finance_viewer只可讀handoff，不能改SLA/approve/notes；reviewer可審稿及proof，不能改mission/角色；operator可CRM及申請／交付／completion，不能grant；workspace_admin可該workspace設定及正常授權管理流程。停用staff/membership/role任一立即拒絕workspace操作；global content editor另驗staff及platform grant。Academy草稿只向平台editor開放，published Creator內容仍依既有level規則讀取。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [ ] **3. 完成可review改動。** grant表RLS不允許anon/authenticated自行新增或改角色，所有授權動作經具access.manage的server流程及audit；測試自我升權被拒絕。沿用brand_users一人一workspace限制。先輸出將失去存取者的匿名化差異及rollback，再由owner核准指定現有staff grant，不能在migration自動把所有staff當admin。角色資料變更需可追溯；部署兼容窗口與舊client行為寫清楚。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run server/lib/staffCapabilities.test.ts
npm run test:integration  # 加入audit-staff-capabilities
```

- [x] **5. 核對完成條件並交接。** 角色矩陣有實際API/RLS證據，既有membership邊界保留；不宣稱已支援多品牌membership。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。


**D18 執行補充：** 第3項的local code／匿名影響／rollback及owner流程已交付；正式現有人員grant及cutover不在本輪授權，故該步驟保持open。沒有自動升權／正式membership或角色修改。以identity-gated `run-integration.mjs staff`（8項）及 `run-staff-browser.mjs`（4項）取代有廣泛seed/delete的integration。原16／194、brand_users(user_id)及D15內容blocker保留；沒有local commit/push/merge/deploy。完整命令／counts／schema／歷史／限制見 `docs/verification/D18-delivery.json`。下一項D19。

### D19 · 整合107案例、發布證據與受控pilot交接

**階段：** GATE　**依賴：** D01, D02, D03, D04, D05, D06, D07, D10, D11, D16　**規模：** L　**狀態：** R1 verified local/disposable；未部署／未啟用；正式staff與D15內容blocker保留

**對應：** 完整旅程／新產品要求；案例 UC-C13, UC-C14, UC-C15, UC-C16, UC-C17, UC-C33, UC-C36, UC-A09, UC-A18, UC-A19, UC-A45, UC-A46, UC-A49, UC-S04。

**Files：**

- 延伸 docs/verification/2026-10-23-adfocate-release.md
- 依需要修改 scripts/run-integration-tests.mjs納入本計劃新增suite
- 沿用 scripts/release/、.github/workflows/及docs/operations/production-release-foundation.md
- 新增 docs/verification/adfocate-delivery.json

**Interfaces（新增者為本計劃設計）：** delivery.json={headSha,schemaManifestDigest,environmentIdentity,codeStatus,testStatus,deploymentStatus,runtimeStatus,caseResults,remainingRisks,approvalRequired,nextTask}；每案列originalAuditResult及newResult，newResult預設not-run。R2擴大發布再加入D08/D09/D12/D13/D14/D17/D18為依賴。

- [x] **1. 固定失敗情境及assertions。** 107案例都有owner、release scope及結果，不允許空白。R1的16個稽核回歸均綠；已有194契約仍通過；原2 clock failures已修；必要DB/E2E不得skipped。另測reward redemption、campaign settlement、content、notifications/cron及public passport等支援路徑，或明示未在該release啟用及殘餘風險。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 跑同final SHA適用gates；比較tests後diff。R1只可稱單workspace內部pilot ready，R2需要所有支援面可驗收。先準備release changeset、hash、expiry、rollback與對象，最後才依當次授權執行protected workflow；沒有部署權限也要完成可review成果。七日pilot若日後授權，再按既有observer執行，不以本次計劃擅自建立排程。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
TZ=Asia/Hong_Kong npx vitest run src/audit-tests --maxWorkers=2 --minWorkers=1
npm run test:active-missions
npm run test:integration
npm test
npm run lint
npm run type-check
npm run build
npm run release:check
git diff --check
```

- [ ] **5. 核對完成條件並交接。** code/test/deployment/runtime四種狀態分開；沒有外部授權停在release-ready且提供具體可核對變更，不稱production完成。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。


**D19 本輪交接：** local／disposable 驗證及可review材料已完成，見 `docs/verification/D19-delivery.json`。第5項中的protected workflow／commit／pilot／observer不在本輪授權，保持未執行；正式staff owner grants／銜接、D15真實核准教材及hosted/manual驗收仍open。沒有push／merge／deploy或正式membership／角色修改。下一項D20未開始。

### D20 · 嵌入式AI brief coach與審稿摘要試行

**階段：** R3　**依賴：** D07, D12, D16, D18, D19　**規模：** L　**狀態：** offline-implemented / mock-verified；real provider disabled

**對應：** 完整旅程／新產品要求；案例 新增產品案例，見new_product_acceptance_cases.csv。

**Files：**

- 延伸 server/lib/assistant/{tools,prompt,retrieve,chat}.ts、server/routes/assistant.ts
- 新增 src/components/assistant/MissionAssistPanel.tsx、server/lib/assistant/contextPolicy.ts
- 新增 tests/fixtures/assistant-workflow-eval.json、server/lib/assistant/contextPolicy.test.ts
- 新增 docs/verification/adfocate-assistant-evaluation.md

**Interfaces（新增者為本計劃設計）：** AssistContext={workspaceId,role,missionId,workflowId?,workItemId?,versionId?,mode:"explain_brief"|"summarize_changes"}；server逐ID重新授權，roles由session/capabilities取得。輸出沿用answer/citations，新增basisVersion與limitations；tools僅read-only。

- [x] **1. 固定失敗情境及assertions。** 新增N04–N09：24組golden cases分規則解釋、版本差異、未知、跨scope、prompt injection、故障各4組；安全/未知邊界100%，答案rubric≥90%。Creator不能讀internal notes；舊version有過時標示；惡意brief不能要求approve、改獎勵、讀B帳戶；拒絕後無tool副作用。
- [x] **2. 跑對應targeted test，記錄原始結果。** 失敗須對應產品行為，不可只是錯路徑、fixture缺欄位或import失敗；已在最新HEAD修復者記錄pass及commit來源，跳過重複改碼。
- [x] **3. 完成可review改動。** 按需開panel，先顯示確定性checklist，再允許AI解釋。feature flag預設off；修稿摘要供人手確認，不能改審批狀態。先離線fixtures與mock；獲准provider、預算及測試內容後做有限真實eval，記token/latency/error。對外MCP及自動發布不在此任務。
- [x] **4. 執行以下驗證。** 預期該任務assertions全部PASS；其他尚未開始的稽核測試保留明確fail。含註解的命令有前置條件，不能盲目貼整段執行。

```bash
npx vitest run server/lib/assistant/contextPolicy.test.ts server/lib/assistant/tools.test.ts
npx --no-install playwright test e2e/mission-assist.spec.ts  # 本任務新增
```

- [x] **5. 核對完成條件並交接。** AI能解釋有來源的工作要求，且不改變權限或業務狀態；沒有真實provider驗收就保持disabled。 更新task/case ledger及evidence；對應diff review後，依授權保存小範圍local commit。

D20 執行紀錄：只完成當次獲准的離線及 mock 範圍；24 子案例、88 targeted、1931 full pass／363 skip、6 Edge mock 及靜態 gates。真實 provider 品質／用量驗收未執行，R3 不放行。詳見 `docs/verification/D20-delivery.md` 及 `adfocate-assistant-evaluation.md`。

## Gate與交接規則

R1離線/隔離gate：D01–D07、D10、D11、D16完成；16項稽核回歸轉綠；194既有契約及適用full suite通過；legacy與active兩條旅程的DB及browser證據齊備；reward neutrality全相等；無未解釋權限問題。

R2擴大使用gate：加上D08/D09/D12/D13/D14/D17/D18。107案例矩陣的每項均有新結果；既有支援功能若繼續啟用，必須完成其驗收。未完成的實際功能不能單靠在CSV標deferred而獲放行，需停用或由產品owner接受具體有界風險並對用戶清楚揭示。

R3 gate：有核准教材、AI評估及使用量證據才開feature flag。關閉R3不能令R1/R2工作流程失效。

每個結果分為code implemented、tests verified、deployment verified、runtime verified。沒有staging身份／credential時相關case記blocked；沒有執行記not-run；不要把預期紅測試說成已修。Production readiness需exact SHA＋schema manifest＋deployment關聯證據。

首輪完成後輸出`docs/verification/adfocate-delivery.json`、測試log、task ledger、case ledger、schema差異、rollback及下一個具體任務。所有外部動作只依當次授權處理；先完成可review材料，不因等待發布權限而停下local工作。
