# D18 營運角色能力分離及安全銜接

D18 已完成本輪 local／disposable 實作及驗證，**未部署**。D15 `BLOCKED_CONTENT_NOT_PROVIDED` 保留，UC-C18／UC-A51 原四堂真實核准課程仍 OPEN。正式既有 staff 的影響名單、owner grant／bootstrap 及切換仍須另有明確授權；本輪沒有修改正式 membership 或角色資料。

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 既有 admin gates 加能力矩陣；transaction/revision/idempotency/audit；業務角色 UI 及復原 | 216 targeted; 1849 full pass / 363 skip; 16 audit +194 contracts; 8 real API +4 Edge | 未部署 | 8 真實本地 API、4 Edge；三方刷新持久化 handoff，原始 neutrality 一致 |

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`。執行介面核實 `gpt-6.1-sol`，沒有自行切換。沒有 commit／push／merge／deploy。前輪 dirty 工作保留。本輪34個code/test/script/config/schema差異，fingerprint `2219e09897ddc5ab7703d403862958420f8f40ac27b60d88cb94b9a8ca069296`；[本輪patch](D18-changes.patch)、[全inventory](changed-files.json)、[前輪checkpoint](D18-prior-code-fingerprint.json)。

## 能力及銜接

workspace_admin 有10項workspace能力；operator 可 CRM／申請／交稿／proof／completion／reward.read；reviewer 只 creator.read／交稿／proof；finance_viewer 只 reward.read。global Academy/content 只平台 content_editor，不繼承workspace角色。品牌 owner/member、JWT metadata、舊shared secret均不會升權。保留 staff、active membership、workspace alias/resource checks，未知操作deny，逐一測試所有已mount的admin routes。`brand_users PRIMARY KEY(user_id)` 沒有改成多品牌模型。

正常grant由access.manage server流程處理；self-change拒絕、actor由server指定，stale revision／變更payload409；三個並行同key請求只產生一筆audit。授權／grant／audit／receipt同transaction，audit失敗全部rollback；同session停用staff/member/role立即拒絕，即使replay亦重新驗權。首位admin及平台角色只有protected DB-owner bootstrap，須明確approval reference；它只是owner attestation，不是另一個approval系統。migration零自動grant。沒有新增grant管理畫面；[API、owner程序、影響與rollback](../operations/staff-access-transition.md)已可review。

role discovery失敗503可retry而不卸載表單；平台editor不需要workspace或重新登入；finance無SLA寫入／workflow連結；reviewer無CRM批准／note controls。MissionEditor403有中英文owner覆核說明，原輸入保留。schema503、membership403、capability403、foreign404與409分開。伺服器仍是安全邊界，UI過濾不代替驗權。

## Schema、manifest及資料範圍

新forward檔 `supabase/migrations/20261023124149_staff_access_capabilities.sql`，4個RLS表、3個routine、6個支援index；anon/authenticated無table／RPC權限，service只有SELECT與正常grant RPC的EXECUTE，不能直接寫表或呼叫private bootstrap/engine。41份manifest entries、529個distinct current capabilities（新增28），digest `44909fc5e4981f81b57281326c7db3117e9e76b4dc2c94806b7aa52fca621d12`；40份原entry及舊SQL/checksum不變。

empty history70→71，shaped54→55；read-only before/after的舊tables/grants、policies、SECDEF/staff functions、history及brand PK一致。migration當刻兩庫的4表count均0。只在empty建立3輪合成fixtures，共33個新Auth actors／6workspaces；包括第一輪afterAll XP假設失敗的資料，全部exact IDs保留，不cleanup/reset。當前workspace grants21、platform grants3、audit/receipts各30；shaped仍全0。原empty256位active staff／154個active membership scope在排除本輪新ID後完全相同；這不是production影響審查，也不是全舊row-data snapshot。[Schema diff](D18-schema-diff.json)、[catalog](D18-schema-after.json)、[forward receipt](D18-forward-replay.json)、[pre-change匿名影響](D18-access-impact-before.json)、[retention](D18-fixture-retention.json)。

local CLI advisors共471（375 INFO／96 WARN），沒有新增WARN；8個新RLS no-policy INFO為刻意default deny，另有新index的unused INFO。逐項保留owner角色／risk／validation；具名owner及hosted acceptance仍pending。舊unused-index notice隨local讀取消失，不當作修復；沒有刪index或放寬policy。[逐項處置](D18-advisor-dispositions.csv)、[完整notices](D18-advisor-review.json)。

## 完整角色交接及neutrality

Creator競爭join→收貨→draft／submit→reviewer要求修稿→Creator重交→reviewer approve-to-publish→proof correction／重交／verify→operator completion及同key replay→finance只讀。Creator、operator與finance刷新仍對應同一pending row，history超過8項；內部pending ID在Creator安全DTO刻意為null，逐欄比對其獎勵／狀態／時限／createdAt，並以operator/finance ID與唯一workflow/submission DB row核對。沒有為通過測試公開內部ID。[真實API78次回應／8cases](D18-api-contract.json)、[4項Edge](D18-browser-summary.json)、[handoff readback](D18-handoff-ui.json)。

既有成功join會+10 XP。這一步單獨以raw initialBefore→joinBaseline.asserted +10記錄；其後交付／proof／completion及所有role/瀏覽器檢查的XP、points、withdrawable、point/cash/budget ledger、budget、redemption及inventory原始快照完全相同。沒有reset或normalize XP。pending reward不等於付款，沒有增加ledger、可提現額、扣預算或新付款功能。[API raw](D18-api-contract.json)、[browser raw](D18-browser-neutrality.json)、[既有join source](D18-existing-join-contract.json)。D17報告原「兩位XP0」文字有明列更正，raw實為10／0且前後相同；原snapshots及D17 JSON保留。

## 測試與限制

先保存行為RED，再最小改動：finance SLA／reviewer mission／inactive role／平台權限、未知route、空migration缺RPC、移除membership後撤銷、角色UI／permission EN-ZH等。非產品RED另列：release helper名錯誤、錯validation payload、browser私有ID假設及read-only欄位名、ESM import、retention query。首輪full1847 pass／2fail是舊scope fake缺explicit grant；只補資料，原200／404及workspace斷言不變。[完整歷史](D18-test-history.json)。

最終267檔full suite **1849 pass／363 skip／0 fail**；原16稽核及194契約綠且原assertions不改。216 targeted（29檔）、8項UI follow-up、8項real API及4項Edge通過；lint0errors／4個舊warnings、type-check、manifest、Node22 build／native ESM及diff check通過。303個source hashes在最後runtime／pre-suite／post-suite一致。[每檔assertions](D18-suite-results.json)、[命令及logs](D18-delivery.json)。未跑的363項保留skip，含broad shared-seed integration；沒有以local成功代替hosted／完整pilot驗收。

Proof metadata為明示mock unavailable；access discovery503是UI transport mock，其餘API/Auth/RLS／DB持久化為本機真實服務。只有installed desktop Edge及CSS viewport，沒有Safari、實機、screen-reader認證、production／CI／hosted或真實providers。沒有真實通知／邀請／付款／付費AI。原107cases／28findings／CSV原欄位及originalAuditResult不變；D08/D09/D12/D13/D14/D15/D17記錄deep-equal；F27 parent Metadata(JSON)限制保留。完整legacy payout／earlier R1 runtime只留歷史fingerprint，不在本輪重新宣稱R1 verified或D19 ready。

## Rollback與下一項

Prefer fail-closed access and a reviewed forward repair. Reverting the pre-D18 server restores broad staff rights and requires explicit owner/security review. Review only D18-changes.patch hunks; retain earlier dirty work, additive schema, exact fixtures and audit/history. No reset, broad delete, membership workaround or old SQL checksum edit. Hosted rollback remains unperformed and separately authorized.

canDeploy／canEnablePilot仍false，production evidence expiry未延長。[正式review材料](release-review-request.json)已更新到新manifest／fingerprint，未請求也未執行正式授權。下一項 **D19**：針對最後candidate更新完整單workspace pilot證據，保留D15內容與既有staff owner／hosted限制。

## Changed code/test/config/schema files

- `e2e/staff-access.spec.ts`
- `playwright.staff.config.ts`
- `scripts/audit/run-integration.mjs`
- `scripts/audit/run-staff-browser.mjs`
- `scripts/release/contracts.ts`
- `scripts/release/manifest.test.ts`
- `scripts/release/manifest.ts`
- `scripts/release/preflight.test.ts`
- `scripts/release/staff-access.test.ts`
- `server/lib/staffCapabilities.test.ts`
- `server/lib/staffCapabilities.ts`
- `server/routes/admin.ts`
- `server/routes/adminStaffAccess.ts`
- `server/test/audit-admin-scope.test.ts`
- `server/test/audit-staff-capabilities.test.ts`
- `server/test/staff-access-schema.embedded.test.ts`
- `server/test/staff-capability-boundary.test.ts`
- `server/test/staffCapabilityFixture.ts`
- `src/components/admin/AdminShell.tsx`
- `src/components/admin/AdminSideNav.tsx`
- `src/components/admin/AdminTopBar.tsx`
- `src/components/admin/MissionEditor.permissions.test.tsx`
- `src/components/admin/MissionEditor.tsx`
- `src/components/admin/RewardHandoffQueue.tsx`
- `src/components/admin/StaffAccessContext.tsx`
- `src/components/admin/StaffAccessShell.test.tsx`
- `src/components/admin/WorkspaceSwitcher.tsx`
- `src/components/admin/useAdminQueueCounts.ts`
- `src/components/operator/CreatorReviewRow.tsx`
- `src/components/operator/ReviewActionPanel.tsx`
- `src/lib/admin.ts`
- `src/lib/i18n.dict.ts`
- `supabase/migrations/20261023124149_staff_access_capabilities.sql`
- `supabase/release-manifest.json`

封存補充：本輪獨立patch保留EOF marker並以canonical LF輸出；Windows工作檔混合EOL，使用 `git apply --check --reverse --ignore-space-change docs/verification/D18-changes.patch` 唯讀核對可逆性，沒有套用或修改工作檔；303個canonical-LF source hashes另行逐檔核實。
