# KOCmax Stage 4 Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將創作者自行授權的 Instagram 成效和指定 Drive 文件帶進私人工作室，保留來源與分享權限，再接回原任務核實及獎勵流程。

**Architecture:** 在現有 Hono／Supabase 邊界內加入獨立 connection service、provider adapters 及帶權限版本的來源 snapshot。對話只使用經後端核准、創作者選取的來源；任務、審稿、結算仍由原服務處理。先以 fake providers 完成本地可驗收版本，真實連接與部署各自受獨立批准控制。

**Tech Stack:** 現有 React 19、TypeScript、TanStack Router／Query、Hono、Supabase/Postgres、Vitest、Testing Library、Playwright／內建瀏覽器；沿用 lockfile。Google OAuth 使用實作時核對版本的官方 `google-auth-library`，若新增需記錄版本與理由。不為本期引入新的外部 MCP 聚合服務。

**Spec:** [Stage 4 規格](../specs/2026-10-31-kocmax-stage-4-integrations.md)。基準 `27353a3`。用戶已批准 4A–4C，限定本機 mock providers；仍未批准真實連接或部署。

## 本次執行範圍

下方保留原設計的細項清單，包含尚未啟用的真實 adapter 工作，因此不能把全部原 checkbox 當作已通過。本次以 [驗證報告](../../review/kocmax-stage-4/verification.md) 記錄實際完成與證據。

| 階段 | 本次實作 | 明確保留到真實 adapter／4D 驗收 |
| --- | --- | --- |
| 4A | 私人 schema、owner/workspace 隔離、預設關閉開關、一次性模擬授權、加密模擬憑證、generation、刷新／撤銷／重試 | 真實 authorization-code/PKCE、平台 callback 簽章、持久金鑰管理、真實 JWT/Auth/RLS |
| 4B | 兩個可注入 mock provider、成效缺值與限制、明確選檔、權利／版本／大小檢查、手機桌面技能卡和選檔 dialog | 官方 SDK/Picker、Meta 版本及指標矩陣、串流下載與真實 PDF parser |
| 4C | 私人來源、獨立 AI/處理/分享同意、Brief 與原任務交接、短效一次性許可、撤銷／刪除／匯出、原功能回歸 | 真實平台／模型／跨瀏覽器登入／遠端資料保留／備份還原驗收 |

實作檔案以 `service.ts`、`memoryRepo.ts`、`mockProviders.ts` 及 provider normalizers 組成原計畫的 OAuth/sync 邊界；沒有加入 Google SDK 或新套件。前端預覽使用真實元件與同一套 mock service。瀏覽器驗收以內建瀏覽器執行並記錄矩陣；不為了本機 UI 驗收開啟既有遠端 audit runner。

本次 mock 驗收清單（原始完整設計細項保留於下方）：

- [x] Task 1：私人資料與開關；owner/workspace、RLS 與 service-only 邊界的本機測試。
- [x] Task 2：模擬授權／加密／刷新／撤銷；generation、一次性 state、超時與重試測試。
- [x] Task 3：Instagram 模擬成效、選取範圍、缺值與限流；live version 未驗證。
- [x] Task 4：Drive 模擬選檔、文件限制、版本／權利重查；真實解析另列待辦。
- [x] Task 5：私人來源 → 對話 → Brief → 原任務；一次性權限與競態回歸。
- [x] Task 6：手機／桌面元件及權限狀態；內建瀏覽器與元件測試。
- [x] Task 7：私人匯出／撤銷／清除／保留指令；無遠端排程。
- [x] Task 8：完整回歸失敗項已修正、54 項最後針對重跑、51 項瀏覽器記錄、獨立複查、build/lint/manifest/bundle。
- [ ] Task 9：未批准，沒有執行任何真實連接或部署。

## Global Constraints

- 第一版只提供兩個可選技能：Instagram「成效雷達」、Google Drive「靈感背包」。
- 不為連接、同步、聊天或重複匯入發積分或 XP。
- `INTEGRATIONS_ENABLED`、`INSTAGRAM_CONNECTIONS_ENABLED`、`DRIVE_CONNECTIONS_ENABLED` 預設 false，伺服器為權威；撤銷／刪除不可被停用讀取的開關封鎖。
- 不 push、merge、部署、建立遠端環境／OAuth app／金鑰、套用遠端 migration 或建立真實連接，直到取得對應批准。
- 所有新資料綁既有 creator／workspace；個人來源不寫入全站 KB、公開護照、品牌評分或其他人的上下文。
- Google `drive.file` 的 OAuth 寫入能力要明示；本地測試可先實作，真實使用前要取得 scope 取捨的明確接受。
- 不重寫既有 migration、重置帳本、修改凍結 reward contract 或擴張營運／審稿／財務權限。
- 失敗保留使用者草稿；403 後不得以過時快取恢復私人內容；資料不足不補零或換地區。
- 文件／網頁內容不可信；它們不能決定工具、接收者、scope、分享同意或系統指令。

## Review Focus

1. 撤銷發生在同步、OAuth callback、LLM 回應或分享之間：舊 generation 不得再落地或重放。歸 Task 2、5、7。
2. 同工作區不同創作者／相同 Google 帳號不同工作區：不可因共用 ID、快取或 service-role 查詢越權。歸 Task 1、4、5。
3. 可讀不等於可轉分享，缺資料不等於零，API 出處不等於任務驗證。歸 Task 3、4、5。
4. Picker 的瀏覽器 token 仍有 provider scopes，模型／XSS／日誌不得取得或擴用。歸 Task 2、4、6。
5. 平台拒絕、部分授權及 mobile 返回失敗：原輸入、手動來源及原角色工作流仍可完成。歸 Task 6、8。

## 分工與檔案地圖

新檔名是本計畫的建議落點；現有檔案已在本機核對。實作前先重新核對基準差異，若有新上游修正，保留並更新此地圖。全部修改留在既有分支。

| 區域 | 新檔 | 修改現有檔 |
| --- | --- | --- |
| 共用資料與授權 | `server/lib/integrations/{types,policy,repo,credentials,oauth,lifecycle}.ts` | `server/app.ts`、`server/routes/account.ts` |
| Provider | `server/lib/integrations/{instagram,googleDrive,sync}.ts`、`provider-manifest.json` | 不改寫 `server/lib/social/` 的 legacy provider 行為 |
| API／工具 | `server/routes/integrations.ts`、`server/lib/integrations/tools.ts` | `server/routes/studio.ts`、`server/routes/assistant.ts`、`server/lib/studio/assistantContext.ts` |
| 來源／分享 | `server/lib/integrations/evidence.ts` | `src/lib/studio/{types,policy}.ts`、`server/lib/studio/staffProjection.ts` |
| UI | `src/lib/integrations/{types,queries}.ts`、`src/components/integrations/{ConnectionCard,ConnectionConsent,DriveSourcePicker,IntegrationSourcePanel}.tsx` | `src/routes/_app.connections.tsx`、`src/components/studio/StudioWorkspace.tsx`、`src/components/studio/studio.css` |
| Schema | `supabase/migrations/20261031120000_creator_integrations.sql`、`20261031121000_studio_integration_evidence.sql`、`20261031122000_integration_privacy_cleanup.sql` | 不修改舊 migration；若執行時時間戳已被佔用，改為下一個未使用的遞增時間戳 |
| 驗證 | Task 1–8 指定 tests、`scripts/audit/studio-integrations.spec.ts` | `src/test/studioPreview.ts`、`src/test/studioPreviewJourneys.ts`；沿用 `scripts/studio-dev.mjs`，不另建正式入口 |
| 交付 | `docs/review/kocmax-stage-4/{verification.md,journey-matrix.csv,provider-capabilities.md,privacy-runbook.md}` | 保留 Stage 3 報告，不覆寫過去結果 |

## 共用合約

以下定義位於 `server/lib/integrations/types.ts`；前端安全 DTO 位於 `src/lib/integrations/types.ts`，不得 re-export token 類型到 client bundle。

```ts
type ProviderId = 'instagram' | 'google_drive';
type Actor = { creatorId: string; workspaceId: string };
type Availability = 'available' | 'missing' | 'unsupported' | 'stale' | 'revoked' | 'rate_limited';
type EvidenceValue = { value: number | null; availability: Availability; reason: string | null };
type ConnectionRef = Actor & { id: string; provider: ProviderId; generation: number };
type ProviderSnapshot = {
  resourceId: string; sourceVersion: string; contentHash: string;
  fetchedAt: string; observedAt: string | null;
  period: { start: string; end: string } | null;
  coverage: { region: string | null; language: string | null; partial: boolean };
  metrics: Record<string, EvidenceValue>; excerpt: string | null;
};
type SourceUse = 'read' | 'model' | 'save_brief' | 'share';
type UsePermit = {
  id: string; sourceId: string; snapshotId: string; generation: number;
  contentHash: string; use: SourceUse; expiresAt: string;
};
```

`UsePermit` 由後端保存並核實，不是接受用戶自填的授權物件。分享 permit 最長 60 秒且一次使用，綁定完整 share payload；時間未過仍須檢查 generation／來源版本。外部 ACL 無法跨平台與 DB 原子化，分享前立即重查並縮短時間差，收到撤權訊號後拒絕落地；不能聲稱消除所有外部變更競態。

公開 API 摘要：`GET /api/me/integrations`；`POST /api/me/integrations/:provider/start`；固定 callback；`POST /api/me/integrations/:id/sync`；`POST /api/me/integrations/:id/resources`；`POST /api/me/integrations/:id/revoke`。所有 state-changing API 驗證 session、origin／CSRF、payload 與 owner；callback 另驗一次性 state 並確認當前帳號仍相符。Provider revoke／data-deletion callback 驗證簽章、時效與防重放，只做生命週期管理。

## Task 1：可隔離的連接資料與預設關閉開關（4A）

**Files:** 新增 `server/lib/integrations/{types,policy,repo}.ts`、第一份 migration；新增 `server/test/integrations-schema.test.ts`、`server/lib/integrations/policy.test.ts`。

**Interfaces:** `requireOwnedConnection(actor: Actor, id: string): Promise<ConnectionRef>`；`isProviderEnabled(provider: ProviderId): boolean`；owner-scoped repository 只回傳安全 DTO。Credential table 使用 private schema，禁止 browser roles 的直接讀取；metadata RLS 及 composite foreign keys 同時限制 creator／workspace。

- [ ] 寫 `rejects_cross_creator_and_workspace`、`credentials_not_browser_readable`、`flags_default_off`；fixture 含兩創作者、兩工作區和同名 provider subject，跨 owner insert/read 必須失敗。
- [ ] 跑 `npx vitest run server/test/integrations-schema.test.ts server/lib/integrations/policy.test.ts`，先確認失敗。
- [ ] 實作 schema／policy／repo，建立唯一冪等鍵及 generation 欄位；既有連接與公開 social 表不自動 backfill。
- [ ] 重跑上述測試為 PASS；本地 SQL 測試與真正 JWT/RLS 測試分開記錄。
- [ ] 本地 commit：`feat(integrations): add private connection foundation`。

## Task 2：OAuth、憑證及撤銷競態（4A）

**Files:** 新增 `server/lib/integrations/{credentials,oauth,lifecycle}.ts`、`server/routes/integrations.ts`；修改 `server/app.ts`；新增 `server/lib/integrations/{oauth,lifecycle}.test.ts`、`server/test/integrations-routes.test.ts`。

**Interfaces:** `beginConnection(actor: Actor, provider: ProviderId, sessionBinding: string, returnPath: string): Promise<{authorizationUrl: string}>`；`completeConnection(actor: Actor, sessionBinding: string, code: string, state: string): Promise<ConnectionRef>`；`revokeConnection(actor: Actor, id: string): Promise<{local: 'revoked'; provider: 'revoked' | 'pending' | 'manual_action'}>`。Provider HTTP、clock、random、cipher 皆可注入；token 永不在安全 DTO。

- [ ] 寫 state 十分鐘過期、重放、session／workspace／provider 換綁、return URL 注入、部分 scopes、刷新鎖、晚到 callback、撤銷重試及 token log redaction 測試。
- [ ] 跑 `npx vitest run server/lib/integrations/oauth.test.ts server/lib/integrations/lifecycle.test.ts server/test/integrations-routes.test.ts`，確認缺實作時 FAIL。
- [ ] 實作 auth-code、支援平台的 PKCE、精確 scope 檢查、加密封裝、generation fencing；所有 provider HTTP 在本地使用 fake transport。處理 provider deauthorization／data deletion 時同樣封鎖舊 generation。
- [ ] 重跑為 PASS；檢查錯誤、metrics、產品返回 redirect 及 snapshot 不包含 token。平台 callback 的短效 code 只處理一次，不記錄到 access log／analytics；用內容 allowlist 禁止任意 provider 方法，但容許獨立的 token／revoke 管理端點。
- [ ] 本地 commit：`feat(integrations): secure authorization and revocation lifecycle`。

## Task 3：Instagram 成效雷達（4B）

**Files:** 新增 `server/lib/integrations/{instagram,sync}.ts`、`provider-manifest.json`、`instagram.test.ts`、`sync.test.ts`；fixture 位於 `server/lib/integrations/fixtures/instagram-*.json`，全為合成資料。

**Interfaces:** `readInstagramInsights(connection: ConnectionRef, input: {days: 30; mediaLimit: 50}, signal: AbortSignal): Promise<ProviderSnapshot[]>`；`syncConnection(actor: Actor, id: string, requestId: string): Promise<{runId: string; status: 'queued' | 'partial' | 'completed' | 'rate_limited'}>`。快取／去重包含 owner、generation、API version、metric、期間與資源。

- [ ] 依官方 endpoint reference 與 changelog 完成 version／metric capability manifest，寫入 `provider-capabilities.md`；記錄每個指標對應的登入方式、媒體類型、期間及限制，不用未核對的舊示例值。
- [ ] 寫空集→null、真實0→0、少於100followers、unsupported／deprecated metric、刪除媒體、分頁達50、30日期間、60分鐘冷卻、429 backoff、重複 request、撤銷中止測試。
- [ ] 跑 `npx vitest run server/lib/integrations/instagram.test.ts server/lib/integrations/sync.test.ts`，先 FAIL。
- [ ] 只實作 manifest 允許的讀取，記錄 partial coverage；不讀 DM／留言正文／廣告，不寫舊 social projection，不聲稱擁有權已核實。
- [ ] 重跑為 PASS，連同 `npx vitest run server/lib/social server/test/social.test.ts server/test/cron-social-refresh.test.ts` 保留既有行為。
- [ ] 本地 commit：`feat(integrations): add private Instagram insights adapter`。

## Task 4：Drive 指定檔案讀取（4B）

**Files:** 新增 `server/lib/integrations/googleDrive.ts`、`googleDrive.test.ts`；新增 `src/components/integrations/DriveSourcePicker.tsx`、`DriveSourcePicker.test.tsx`；擴充 integrations routes。

**Interfaces:** `registerSelectedFiles(actor: Actor, connectionId: string, fileIds: string[]): Promise<string[]>`；`readDriveFile(connection: ConnectionRef, resourceId: string, signal: AbortSignal): Promise<ProviderSnapshot>`；`createPickerSession(actor: Actor, connectionId: string): Promise<{accessToken: string; expiresAt: string}>`，僅此明確 endpoint 可回傳 Picker access token，回應 no-store。

- [ ] 寫 `rejects_unselected_file`、`rechecks_owner_mime_and_download`、`denies_write_operations`、`revoked_after_picker`、`version_changed`、`rejects_over_5_files_or_5_MiB`、PDF 惡意內容／捷徑、取消不匯入、Picker token 不落 storage／log 測試。
- [ ] 跑 `npx vitest run server/lib/integrations/googleDrive.test.ts src/components/integrations/DriveSourcePicker.test.tsx`，先 FAIL。
- [ ] 實作 Google Docs／text／文字PDF 白名單、export/download 串流大小限制與安全解析；摘錄限8000字元。先以假的 Picker/session 驗證，真實 SDK 請求保持關閉。不新增 files.create/update/delete、permissions.create 或 upload view。
- [ ] 重跑為 PASS；同 file ID 在不同 owner／generation 下無快取共用，讀取失敗不送模型。scope 說明顯示「Google 授權包含指定檔案修改能力；KOCmax 本期僅提供讀取」。
- [ ] 本地 commit：`feat(integrations): import explicitly selected Drive sources`。

## Task 5：來源許可、對話、Brief 與原任務（4C）

**Files:** 新增 `server/lib/integrations/{evidence,tools}.ts`、第二份 migration；修改 `server/routes/{studio,assistant}.ts`、`server/lib/studio/{assistantContext,staffProjection}.ts`、`src/lib/studio/{types,policy}.ts`；新增 `server/lib/integrations/evidence.test.ts`、`server/test/studio-integrations.test.ts`。

**Interfaces:** `authorizeSourceUse(actor: Actor, sourceId: string, use: SourceUse, sharePayloadHash?: string): Promise<UsePermit>`；`importSnapshotToThread(actor: Actor, threadId: string, snapshotId: string, question: string): Promise<{sourceId: string}>`；`listConnections`／`readInstagramInsights`／`readSelectedDriveSource` 的工具身分由伺服器注入，不接受模型改 owner。模型工具不執行 OAuth、分享、發佈或結算。

- [ ] 寫未同意AI或來源不允許交給處理商時禁止傳送、thread來源隔離、source ID偽造、私人原檔無轉分享權、變更段落／recipient／任務／Brief version、60秒permit過期、分享重放、來源403→503、模型晚到／source撤銷測試。
- [ ] 跑 `npx vitest run server/lib/integrations/evidence.test.ts server/test/studio-integrations.test.ts`，先 FAIL。
- [ ] 以獨立 server-only import command 新增 provider 來源；追加 schema 以支持真實或未知 coverage，保留舊手動HK/繁中限制。原 `status=unverified` 不升格為已核實；共享 caption 改為按來源輸出 coverage／provenance，不能固定印HK。
- [ ] 在原模型 context、save／share command 加入 use permit、hash／generation 再檢查及 transaction；沿用 lineage／idempotency／版本衝突，保留現有輸入長度、選取數量及角色限制。來源重查失敗要阻止新動作並保留本地草稿。
- [ ] 重跑為 PASS，再跑 `npx vitest run server/test/studio-assistant.test.ts server/test/studio-context-recovery-route.test.ts server/test/studio-context.test.ts server/test/studio-routes.test.ts server/test/studio-staff-projection.test.ts server/test/studio.embedded.test.ts src/lib/studio/policy.test.ts`。
- [ ] 本地 commit：`feat(studio): preserve integration evidence and sharing consent`。

## Task 6：全部新狀態的手機／桌面介面（4B–4C）

**Files:** 新增檔案地圖所列其餘 UI／queries；修改 `_app.connections.tsx`、`StudioWorkspace.tsx`、`studio.css`；新增 `src/components/integrations/Connections.test.tsx`、`src/lib/integrations/queries.test.tsx`；擴充現有 Stage 3 開發 fixture。

**Interfaces:** `useConnections()` 回安全DTO；`useIntegrationCommand()` 執行具 request ID 的 owner操作並精準刷新；`ConnectionConsent` 分開說明scope、AI使用、分享；`IntegrationSourcePanel` 只顯示當前thread核准來源。

- [ ] 寫未連接／部分授權／過期／429／撤銷、取消返回原草稿、焦點恢復、讀取錯誤不恢復已被403拒絕的快取、基本任務不鎖住等測試。
- [ ] 跑 `npx vitest run src/components/integrations src/lib/integrations src/components/studio/StudioWorkspace.test.tsx`，確認新案例先 FAIL。
- [ ] 實作規格第4節全部畫面；新技能不附積分、登入連續獎勵或強迫連接。用實際 DOM 元件搭配 fixture，OAuth／Picker 遠端請求仍封鎖。
- [ ] 重跑為 PASS；內建瀏覽器核對390/1440全部狀態，320/430/768/1024抽查；確認鍵盤與減少動畫，截圖入 review pack。
- [ ] 本地 commit：`feat(studio): add responsive connection and evidence journeys`。

## Task 7：匯出、刪除、保留與可復原失敗（4C）

**Files:** 第三份 migration；修改 `server/routes/account.ts`、`server/lib/integrations/lifecycle.ts`；新增 `server/test/integrations-privacy.test.ts`、`docs/review/kocmax-stage-4/privacy-runbook.md`。

**Interfaces:** `exportIntegrationData(actor: Actor): Promise<Record<string, unknown>>` 不含credentials；`purgeIntegrationData(actor: Actor, requestId: string): Promise<{state: 'complete' | 'pending'}>` 可重試；`expireIntegrationData(now: Date): Promise<{purged: number}>` 使用本地clock測試，未批准不接遠端排程。

- [ ] 寫分頁匯出、無token、匿名化後不能refresh、撤權服務timeout、24小時撤權重試期限、暫存24小時／未引用snapshot30日、衍生對話清除、共享最小回執、部分清除重試及還原後刪除清單測試。
- [ ] 跑 `npx vitest run server/test/integrations-privacy.test.ts server/lib/integrations/lifecycle.test.ts`，先 FAIL。
- [ ] 接入原帳號刪除流程與最小回執；generation先失效，再處理外部撤權／快取／內容／索引。credential deletion與provider revocation結果分開，不把待處理標成完成。
- [ ] 重跑為 PASS；runbook寫明誰可看什麼、保留時間、provider失效／資料事件／回退處置；備份與模型處理商能力標為待真實環境驗證，不能寫成已達標。
- [ ] 本地 commit：`feat(integrations): complete privacy and deletion lifecycle`。

## Task 8：本地完整旅程與不回歸驗收（4C）

**Files:** 新增 `scripts/audit/studio-integrations.spec.ts`、`docs/review/kocmax-stage-4/{verification.md,journey-matrix.csv}`，必要時擴充既有browser runner的可選spec輸入，預設行為不變。

- [ ] 建立兩創作者／兩工作區／品牌／reviewer／finance的合成情境；fixture回應標示example，未知路由拒絕，不假裝成功。
- [ ] 在390與1440逐步走完規格第7節完整旅程；走一次Drive中途撤權、一次未連接、一次部分授權、一次scope拒絕、一次平台限流，以及撤銷後重連不恢復舊分享權。
- [ ] 重驗訪客→登入→onboarding、創作者任務、品牌、營運／審稿／財務及CMS入口；新連接不得改變任何原有角色控制或結算規則。
- [ ] 跑 `npm run build`、`npm run lint`、`npx vitest run --maxWorkers=2 --minWorkers=2 --testTimeout=15000`、`npm run test:active-missions`、`npm run release:manifest:check` 及 `git diff --check`。只執行本地測試；先查測試環境，不能讓繼承的環境變數把整合測試導向正式服務。
- [ ] manifest若因新增migration需要更新，使用既有manifest工具生成並review，不能繞過檢查；報告明確分開新增、原有warnings、skips、失敗與未執行。全套完成後只因新改動／失敗才重跑相關項目。
- [ ] 審查production bundle不包含fixture／秘密；新增server與schema測試不得被稱為已完成真實Auth/RLS。確認原公開social投影、role gates、凍結reward contract無非預期差異。
- [ ] 本地 commit：`test(integrations): verify local journeys and regression boundaries`；交付review pack並停在真實連接批准點。

## Task 9：批准後才可做的真實試用（4D）

**Prerequisite:** 用戶明確批准具名非正式環境、測試帳號、文件、scope、AI處理目的地，以及必要的環境／OAuth app設定。普通「完成本地開發」批准不涵蓋本段。

- [ ] 提交具體試用包：兩個自有IG專業測試帳號、一個個人帳號的未支援路徑、兩個Google測試帳號、合成自有／共享／被撤權文件；不用真實品牌或客戶資料。
- [ ] 核對Meta App Review／Advanced Access及所選API version，Google OAuth verification／Publisher設定及實際scope畫面；由所選scope決定額外評估，不把non-sensitive誤稱完全免審查。
- [ ] 實際跑callback、拒絕、token刷新、撤銷／到期、Drive ACL改變及provider外部撤權；用真實JWT驗證RLS／IDOR。token壽命從平台實測／文件記錄，不憑估計硬編碼。
- [ ] 在iOS Safari、Android Chrome、桌面Chrome／Safari／Firefox測試平台允許的登入、選檔及返回；內建瀏覽器不支援時驗證安全轉交，不繞過限制。
- [ ] 真實資料送AI前另外核對已批准的處理商、設定、資料範圍與同意；如未批准，這部分維持mock並在驗收標為未完成。
- [ ] 完成一條非正式端到端任務核實／測試積分旅程，演練撤銷、資料清除及回退。不得發正式積分、付款或測試未經批准的外部寫入。
- [ ] 記錄實際時間、平台版本、問題、資料範圍、截圖及去識別receipt；任何隔離／撤銷／秘密外洩失敗均阻擋開放。平台審查未通過、必要測試未完成或有高風險缺陷，不作正式啟用建議。

## 完成與後續部署

本地Stage 4完成＝Tasks 1–8可重現通過及review pack齊全。整合驗收完成＝Task 9另行獲批准且全部必要證據通過。正式部署／啟用仍需下一次明確批准，並使用現有release流程。

回退時先停新授權、資料讀取及背景落地，維持本地撤銷／刪除與原任務可用；不自動刪schema、不切回隱藏的抓取服務、不恢復舊token。平台健康監控只收去識別錯誤率、延遲、429及刪除積壓，不收文件內容或帳號名。

## 本文件自檢

文件層自檢：兩個provider的scope與取捨、手機／桌面狀態、owner隔離、token例外、來源權限、分享、撤銷、匯出／刪除、反刷分、原功能回歸、真實試用與部署批准點均有對應task。這不是任何執行checkbox已通過的聲明。
