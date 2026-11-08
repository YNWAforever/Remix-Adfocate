# KOCmax Stage 4D / D1 Isolated Pilot Implementation Plan

> **後續狀態（2026-11-03）：** 此為原本的獨立環境方案；下方 2026-10-31 的「共用資料庫尚未批准寫入」只屬當時紀錄。使用者其後批准在現有 Remix-Adfocate 資料庫套用審閱 SQL，完成九帳戶登入／權限實測及精確清理。執行結果、原隔離條件的差距與未驗證項目見 [D1 收尾](../../review/kocmax-stage-4d/d1/D1-CLOSEOUT-20261103.md)。本文件的原始獨立環境任務沒有因共用資料庫測試而自動通過。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. The user's approval boundary overrides execution defaults: this document is a plan only, not permission to provision, deploy or authorize accounts.

**Goal:** 在獨立、可回退的試點環境完成 Instagram／Google Drive runtime 準備與安全預驗，交付可審批的 D2 帳號試點；D1 結束時真實帳號授權與平台內容讀取仍關閉。

**Architecture:** 沿用 D0 adapters、加密憑證、refresh lease、來源世代、私人 Brief 和原任務流程。使用獨立 hosting／Supabase／Google project／Meta app；所有啟動須綁定實際 target、source SHA、schema、origin 和參與者名單。兩平台分別有啟用狀態；環境就緒不等於帳號試點通過。

**Tech Stack:** 現有 React／TanStack Query／Hono／TypeScript／Supabase PostgreSQL；候選 Vercel Node runtime；Google Drive v3 + web Picker；Instagram Login API v26.0；已鎖定的 `pdfjs-dist@6.4.299`。

**Spec:** [原 Stage 4D 計劃](2026-10-31-kocmax-stage-4d-test-pilot.md)、[D0 驗證](../../review/kocmax-stage-4d/verification.md)、[provider 契約](../../review/kocmax-stage-4d/provider-capabilities.md)、[私隱手冊](../../review/kocmax-stage-4d/privacy-runbook.md)。本文件補充 D1，不改寫 D0 與更早驗收。

首次發佈：2026-10-31 HKT。發佈時狀態為待批准，當時只新增計劃文件。

**執行註記（2026-10-31）：使用者其後批准隔離 D1，已開始同分支的本機準備；最新指示改為直接使用現有 Remix-Adfocate 資料庫，並要求先列出影響供確認。此共享方案尚未批准寫入，亦不自動符合下列原始隔離條件。保留原計劃作基線，現況見 [影響評估](../../review/kocmax-stage-4d/d1/existing-database-impact.md) 與 [本機檢查點](../../review/kocmax-stage-4d/d1/verification.md)。沒有遠端寫入、資源建立、真實平台連接或部署。**

## Global Constraints

- 同一分支 `codex/kocmax-studio-stages-1-2`；目前 HEAD `5c60020091e8e6fee934b61c498bf7518944c433`。
- D0 migration SHA-256：`485bee1d9978bced3983a70a846825e410a19805dd47d972739c7ae2c55ebdbc`；manifest digest：`947fbfaba4b5990663adfd6644dccca6f63c2c26a6a261c8741f51fcba75abb5`。D1 修改後重新產生，不沿用舊 receipt 當新版本授權。
- D1 批准只涵蓋明列的隔離資源、配置、部署和合成資料預驗；D2 才涵蓋指定帳號的真實 OAuth／讀取／撤銷；外部 AI 另屬 D3。production、push／merge、真實兌換與品牌交付不在本計劃內。
- 原登入、角色、任務、內容審批、發佈證明、獎勵合約、一次性入帳及近期修正保留；新增 target 限制只對試點生效。未連接仍可用基本任務和手動來源。
- 不複製 production DB、客戶文件、使用者、token、secret 或排程；不共享 production OAuth project/client。連接／聊天／重試不發積分或 XP。
- 最少權限、私人預設、用途分開；未驗證／缺值不補零、不推定香港或繁中覆蓋。所有網頁與文件仍屬不可信資料。

## Review Focus

1. 新環境繼承舊 cron、第三方掃描或模型 key，可能意外出網：Task 1/3 驗證預設禁止及零繼承。
2. Hosting 的登入保護攔住 callback，或為修復而開放整個產品：Task 2 驗證最小公開路徑和匿名反例。
3. 手機返回時 session／帳號／workspace 改變：Task 2/4 保留草稿，但拒絕把 grant 綁給另一個身份。
4. 同一 Google 帳號跨 workspace 的撤銷及舊工作重播：Task 3/5 重驗原 grant 協調、世代與 lease fence。
5. App 停讀仍有直接資料庫讀取，或備份還原復活已刪內容：Task 5 測普通 JWT／直接 API，還原時隔離整個 target。

## 1. 此次核對結果

- HEAD 與 D0 交付一致；本次讀取前工作區乾淨。D0 的完整測試、建置及 IAB 結果是已保存的歷史記錄，本次沒有重跑或把它們改列為遠端驗收。
- `runtime.ts`、`IntegrationService`、`OAuthCoordinator`、前端 queries／Picker 都仍拒絕真實資料；只改環境旗標不能開啟試點。`pilot-preflight.ts` 目前只比較輸入值，不查證遠端身份。
- `vercel.json` 仍含 `/api/cron/social-refresh`、`/api/cron/daily`；後者會執行排程內容發布、排行榜快照與提醒。它們不能隨試點配置自動啟動。
- D0 的 Meta verifier 與 SQL dispatch 已有離線契約，但尚無完整公開 notice route／狀態頁／實際 Instagram ID 映射。PDF worker 的目標 hosting 封裝仍未驗證。
- 知識圖譜要求 project 名稱，而清單查詢未在有界等待內完成；本次依 D0 文件定位並讀取已知路徑，沒有對其他專案建立索引。

公開官方文件於本次再次核對。Instagram Insights 指南更新日期為 2026-10-20，仍列 Instagram Login 的兩個 scope；Business Login 與 OAuth reference 對授權 host 的寫法不同，見下方 IG-03。沒有登入私人平台控制台或測試任何帳號。

## 2. 隔離環境提案

以下名稱是提案，**尚未建立**。先核對現有資源；若已有相同用途的空白隔離專案，只有確認沒有 production 資料／秘密且使用者批准重用後才採用。

| 層 | 擬議配置 | 必須隔離／驗證 |
| --- | --- | --- |
| Hosting | 獨立 `kocmax-integrations-pilot` 專案；固定 HTTPS origin；只部署經核對的 branch artifact | 不接 production alias；停用自動 Git 部署；先準備可審閱 artifact，再按批准部署；其他任意 preview URL 不可開始 OAuth |
| Database／Auth／Storage | 獨立 `kocmax-integrations-pilot` Supabase 專案；空白 DB、獨立 Auth、私有 storage；全 migration chain 與合成 fixture | 不 fork 含真實資料的 production DB；不沿用 production keys、登入 session 或邀請；普通 JWT 驗證 owner/workspace/RLS |
| Google | 獨立 Cloud project + 一個 Web OAuth client；Drive API、Picker API；External／Testing | 只登記 Google A/B；client ID、project number、Picker appId/API key 屬同一專案；不得使用 production grant |
| Meta | 獨立 app，選定 Instagram Login 產品；保留測試／受限使用範圍 | 分別記錄 Meta app ID、Instagram app ID 及對應 secret；不得以名稱相似假定相等；沒有帳號 grant |
| Secret store | Hosting 的 server-only 秘密；持久 active key + previous key IDs；每個環境獨立 | Supabase server key、OAuth secrets、32-byte encryption keys、維護憑證不進前端、git、日誌或計劃文件 |
| 區域與費用 | 核准單列 app／DB／logs／backup 實際區域、付費方案及總費用上限 | 不假稱香港處理；不擅自升級方案、購買網域或增加付費附加服務 |
| 外部服務 | D1 的兩個 provider 都保持未啟用；外部模型、RapidAPI 掃描、郵件／訊息及兌換出口關閉 | 不複製相關 production key；連通 Supabase 測試專案是環境預驗，不是 Instagram／Drive 帳號連接 |

採一個固定的試點 origin，避免手機 OAuth return 及 Picker 的跨 origin 例外。合法 callback、登入、靜態法律說明和不含個資的刪除狀態頁是有限公開面；私人頁面與 API 仍需登入和 allowlist。`noindex`／難猜網址只屬輔助，不能代替授權。

Vercel deployment protection 可能在應用程式前攔截 callback。D1 必須以實際方案核對公開 callback 與私人頁面的共存方式；不可把 OPTIONS allowlist 當成 GET/POST callback 例外，也不可把 bypass secret 塞入 OAuth URL。若既有方案不能滿足，記錄阻礙並提交具體 hosting 差異，不自行開放整個部署。[Vercel deployment protection](https://vercel.com/docs/deployment-protection)

## 3. 權限與資料用途

| 平台／能力 | 擬議 scopes／權限 | 本期行為及限制 |
| --- | --- | --- |
| Instagram 成效雷達 | `instagram_business_basic`、`instagram_business_manage_insights` | 僅自己的支援專業帳號／媒體；不要求發布、留言、私訊、廣告或 Facebook Pages 權限；實授不足則顯示 partial／未驗證 |
| Google 靈感背包 | `https://www.googleapis.com/auth/drive.file` + `openid` | `openid` 只核對穩定 `sub`；不要求 email/profile/Gmail、全 Drive 讀取或網域委派；不改變 KOCmax 登入 |
| Google web Picker | 限核准 origin/API key/project；短期 access token 僅放當次 browser 記憶體 | 不傳 refresh token／secret；關閉釋放引用，不把此動作稱為撤銷 token；不用 native One Pick 替代 web flow |
| 所選文件 | Docs、UTF-8 text、文字 PDF；最多 5 檔、每檔 5MiB、摘錄 8,000 Unicode 字元 | 不列舉整個 Drive、不上傳／改檔／刪檔／改分享；Shared Drives、folders、shortcuts、掃描／加密 PDF 不支援 |
| 來源及 Brief | 預設 owner + workspace 私人 | 可下載、`ownedByMe`、勾選同意都不自動證明素材使用權；未知權利保持私人，任務轉存逐段確認 |
| 模型／獎勵 | 外部 AI 關閉；原凍結獎勵合約只在測試帳本執行 | 原一般／手動 assistant 行為保留在產品，但試點不配置外部模型憑證；連接、同步、重試不發分 |

**Google `drive.file` 本身包含寫入能力。** 產品限制只讀不會縮減 token 的平台權限，授權畫面必須如實披露。Google 將此 scope 列為 non-sensitive，但不表示應用程式品牌、網域、政策或公開使用要求已獲驗證。[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

手機與桌面都是 responsive web，使用 web Picker；它需要 browser access token。真實 Google OAuth 由擁有人在支援的系統瀏覽器完成，遇到 embedded-browser 限制不繞過。內建瀏覽器保留作產品檢視與可支援的 UI 驗證。[Picker 比較](https://developers.google.com/workspace/drive/picker/guides/overview)、[OAuth user-agent 限制](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors)

Google External／Testing 下，此 Drive 用途的 refresh token 有七日到期規則；D2 的八日觀察從首次實際批准授權時計算，不從 D1 建環境時計算。不把 app 改成公開發布來迴避到期。[Google token expiry](https://developers.google.com/identity/protocols/oauth2)

## 4. Instagram 剩餘門檻

| ID | 本次狀態 | D1 要取得的證據／動作 | 未解除時 |
| --- | --- | --- | --- |
| IG-01 撤銷協定 | **BLOCKED**：D0 的 `DELETE graph.instagram.com/v26.0/{user-id}/permissions` 只有候選離線契約；本次仍未取得明確適用 Instagram Login 的官方端點／ID／回應證據 | 取得官方該產品文件或 Meta 正式支援確認：method、host/path、token 類型、ID 類型、成功／失敗回應、重試與撤銷範圍；固定契約後更新 tests | IG 的帳號授權／live transport 不啟用；不以 Facebook Login、舊 Basic Display 或 scraping 代替 |
| IG-02 notice ID 映射 | **BLOCKED**：通用 deletion 文件的 `user_id` 是 app-scoped ID，不證明等同 IG 登入回傳的 ID | 文件化 Meta app／Instagram app／code-exchange subject／profile ID／callback ID 的關係；只接受有依據的映射，完成驗簽、重播及錯 app 反例 | 不做字串直接相等推定；未知映射拒絕並保留處理狀態，不能顯示刪除完成 |
| IG-03 authorize host／產品一致性 | **OPEN**：D0 使用 `api.instagram.com/oauth/authorize`；較新 Business Login 頁列 `www.instagram.com/oauth/authorize`，OAuth reference 仍列前者 | 以批准 app 的 Instagram Login 設定與對應官方文件確定唯一 canonical URL、app ID、redirect URI 及 scopes；把兩者差異列入版本紀錄；不添加雙 host 猜測重試 | 未收斂前不得啟用真實授權；不把 D0 當作已驗證錯誤或已驗證相容 |
| IG-04 存取級別／帳號資格 | **NOT VERIFIED**：尚未查指定 app 控制台 | 核對 Creator／Business 帳號、擁有／管理關係、加入 app 狀態及每個 scope 的 access level；Standard Access 只限符合官方範圍的帳號 | 服務外部不屬於自己／不管理的帳號時，依要求完成 Advanced Access／App Review；加入 tester 不自動解決資格 |
| IG-05 真實回執與資料比對 | **D2 NOT RUN** | D1 先固定上述契約；D2 經帳號批准後，先跑身份／撤銷 smoke，再開媒體讀取，比對 v26.0 raw response、期間／缺值／partial | 協定文件通過不等於實際帳號試點通過 |

本次嘗試的官方 permissions 參考位置沒有提供可用端點內容；沒有把空頁或搜尋無結果解讀為「不支援」或「已確認」。[Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)、[OAuth reference](https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize)

Insights 指南仍列上述兩個 Instagram Login scopes；Standard／Advanced Access 的帳號範圍須按指定 app 核對。[Instagram Insights](https://developers.facebook.com/documentation/instagram-platform/insights)

Meta 通用 deletion 文件要求驗簽、HTTPS、確認碼及可讀的狀態 URL；它不能單獨證明 Instagram Login 的 ID 映射。D1 建立的狀態頁只顯示 pending／completed 和處理說明，不洩露帳號、文件名稱或其他 workspace。[Meta deletion callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback)

Google 的準備可獨立完成；若 IG-01/02 尚未解決，交付明寫 `D1_ENVIRONMENT_READY / INSTAGRAM_BLOCKED`，不得稱雙平台 ready。Google-only D2 亦須另獲指定帳號批准。

## 5. 剩餘工作與檔案分工

| 工作 | 沿用／修改 | 新增的明確責任 |
| --- | --- | --- |
| target 與啟用界線 | `server/lib/integrations/{pilotPolicy,runtime,service,oauth}.ts`、`scripts/integrations/pilot-preflight.ts` | `pilotRuntime.ts`：以已驗證 target 與 D2 receipt 組裝網路 provider；D1 只提供 readiness |
| 環境部署 artifact | `api/index.ts`、既有 release manifest/checks | `vercel.pilot.json`：獨立部署配置、舊 cron 停用；`scripts/integrations/pilot-package.ts`：來源／worker／配置 artifact 清單 |
| routes 與 notices | `server/app.ts`、`server/routes/integrationOAuth.ts`、`metaNotice.ts`、repo／keyProvider | `server/routes/integrationNotices.ts`：簽章驗證、dispatch、回執；`src/routes/_site.integration-deletion.$receipt.tsx`：不含個資的狀態頁 |
| browser 接線 | `src/lib/integrations/{types,queries,googlePicker}.ts`、integrations components | `googlePickerLoader.ts`：只在 D2 明確操作後載入 SDK；`oauthCompletion.ts`：清除 URL ticket、同身份完成並返回草稿 |
| 試點維護 | `scripts/integrations/pilot-maintenance.ts`、`lifecycle.ts` | 獨立 authenticated maintenance route/runner；不掛到既有 social-refresh／daily |
| 真實目標預驗 | 既有 release／integration suites | `pilot-target-verification.ts`：唯讀核對批准 target；`integrations-pilot-target.test.ts`：明確 opt-in 的真 DB／Auth 測試；一般 unit tests 不出網 |
| 證據 | D0 文件保持原貌 | `docs/review/kocmax-stage-4d/d1/` 下 target、permissions、blockers、verification、rollback 及 D2 handoff |

所有新增名稱為 D1 實作落點，不代表檔案已存在。需要 schema 補充時，用當前 Supabase CLI 建立新的 additive migration；不重寫既有 migration，重新更新 manifest 和 capability checks。

## 6. 可逐包驗收的執行順序

### Task 1：來源、target 和權限收據

**Files:** `pilotPolicy.ts`、`runtime.ts`、新增 `pilotRuntime.ts`／`pilotRuntime.test.ts`，`pilot-preflight.ts`／其測試。

**Interfaces:** 定義 server-only `PilotApprovalRecord`，含 stage、owner approval reference、到期時間、sourceSha、schemaDigest、deployment ID、hosting project ID、Supabase projectRef、origin、Google project/client IDs、Meta/Instagram app IDs、creator/workspace allowlist、fixture IDs、per-provider enablement。`verifyPilotAdmission(record, observed, now)` 回傳 `{admitted, phase, providerStates, reasons}`；D1 時兩個 provider 一律 disabled。`observed` 必須來自已批准 target 的實際核對，不能只把 expected 複製進去。

- [ ] 補失敗案例：錯 origin/project/SHA/schema／已過期 receipt／只設定 `NODE_ENV` 或 `INTEGRATIONS_MODE` 不可開啟；錯 actor、假 subject、舊 receipt 亦拒絕。
- [ ] 實作 target observer 與 admission；先按批准的 ID 核對控制面及唯讀身份元資料，通過後才建業務／provider client 或讀寫應用資料。observer 本身亦只能查批准的 target。保留 D0 fixture factory，禁止靠 `sampleOnly=false` 直接放行。
- [ ] 跑該組測試與既有 policy/runtime/preflight；審查沒有一般用途的 `allowLive=true` 後建立本機 commit。

### Task 2：固定 origin、OAuth 與公開通知邊界

**Files:** `integrationOAuth.ts`、`oauth.ts`、`server/app.ts`、新增 `integrationNotices.ts`／route tests、刪除狀態頁及 `oauthCompletion.ts`。

**Interfaces:** 沿用 `OAuthCoordinator.begin/callback/complete` 和 `handleMetaNotice`；只有 Task 1 admission 合法、D2 帳號批准存在，才可注入網路 coordinator。Google／IG callback 分別為 `/api/integration-oauth/google_drive/callback`、`/api/integration-oauth/instagram/callback`。擬議 notice 路徑為 `/api/integration-notices/instagram/deauthorize`、`.../delete`；狀態頁 `/integration-deletion/:receipt`。

- [ ] 先測 callback 的錯 host、重複參數、state/ticket 重播、錯 session／workspace、部分授權、跨 browser 重新登入，以及匿名／其他角色不可列取私人資料。
- [ ] 實作一次性 completion、URL fragment 清除和草稿返回；同一 KOCmax 身份重新確認不能換成另一 actor。保留 10 分鐘 state、5 分鐘 ticket、Google PKCE／nonce／驗簽；不為 IG 捏造未證實的 PKCE 支援。
- [ ] 補 notice HTTP wiring、payload 上限、HMAC／時間／receipt 驗證、明確 ID mapping 及最小狀態頁。錯 app／未知 mapping／延遲通知不能更新其他人的 grant。延遲重送採真實平台契約決定，不盲信 D0 的 24 小時本地 freshness 假設。
- [ ] 在批准的 host 用假 code/state marker 驗證 CDN／access log／error tracing／分析均不洩漏完整值；D1 callback 不交換真實 code。公開面和 host protection 不相容時停在配置問題，不關掉全站保護。
- [ ] 跑 route／OAuth／notice 測試，審查後本機 commit。

### Task 3：隔離配置、憑證、worker 與部署

**Files:** `vercel.pilot.json`、`pilot-package.ts`／測試、`keyProvider.ts`、runtime、`api/index.ts`；既有 PDF worker／lockfile 保留。

**Interfaces:** `buildPilotArtifactManifest(root, approval)` 產生 source SHA、schema digest、配置 hash、worker／dependency hashes、runtime requirement 清單；不部署。部署 receipt 與 Task 1 的 observed target 必須吻合。

- [ ] 先測禁止繼承 production env／DB／bucket／provider credentials；包內缺 PDF worker、版本不符或舊 cron 存在時 fail。原 `vercel.json` 留給原產品，試點使用獨立配置。
- [ ] 批准後建立或配置明列的空白 hosting／Supabase／Google／Meta 資源，登記 owner、區域、費用和 IDs；憑證由批准的秘密儲存管理，不經聊天傳遞。
- [ ] 持久 keyring 可跨重啟解密，舊 key 可重包、新 key 寫入；實際 key rotation 只用試點資料。瀏覽器只得 public key/client ID/受控 Picker access token，不得接收 server key／refresh token。
- [ ] 核對 Node runtime 至少符合 PDF dependency 要求（>=22.13；本機 D0 使用 24.18.0）；在目標 artifact 驗證 worker_threads、`.mjs`、鎖定 parser、逾時與記憶體上限。若 host 不支援，不退回無界主執行緒解析。
- [ ] 建置和檢查完成後，只部署批准的隔離專案；各 provider 授權、讀取與 SDK 載入仍關閉。不 push/merge 原分支、不切 production alias。
- [ ] 驗證兩個 OAuth client 的 exact callback、Google Web origin/referrer/API key restrictions、獨立 scopes、Meta app 身份與 access level；不用任意 preview wildcard。記錄後本機 commit。

### Task 4：手機／桌面的真實接線準備

**Files:** integration types／queries／components、`googlePicker.ts`、新增 loader／completion；相應 UI／query／layout tests。

**Interfaces:** 沿用 `createGooglePickerBridge` 和 `{connectionId,generation}` token 請求；新增 SDK loader 不在 import／mount 啟動。UI readiness 由 server admission 提供，不能由 query string 或 localStorage 自行啟用。

- [ ] 先測 D0/D1 均不能開始真 OAuth、取得真 token、載入 Picker SDK；D2 合法目標才可走已批准的單一 provider。sample 與 live provenance、partial scope、權利未知分開顯示。
- [ ] 準備 live UI 接線、取消／popup 被擋／重新登入返回、token no-store、關閉清理、帳號切換清空私人 cache；保留既有 draft、epoch 與 revoke guards。
- [ ] 以合成 transport 跑 320/390/430/768/1024/1440px、鍵盤/focus、短視窗及減少動畫。內建瀏覽器核對手機與桌面；實機真 OAuth／Picker 留到 D2。
- [ ] 跑 UI/query/layout 及原 Studio 回歸；審查後本機 commit。

### Task 5：隔離 DB／Auth／維護與停止演練

**Files:** 新 target-verification runner/test、維護 route/runner、既有 repository／lifecycle；若有必要加 additive migration。

**Interfaces:** opt-in runner 只接受已批准 target receipt 和 fixture manifest；不從一般測試環境變數偷偷選遠端。沿用 maintenance lease/batch、tombstone 和 source generation。

- [ ] 先寫相同工作區不同 creator、相同 Google subject 不同 workspace、匿名/staff、直接 Data API／RPC、舊 JWT／移除 allowlist 的反例。用普通測試者 JWT 驗證，不以 service-role 結果冒充 RLS。
- [ ] 只在批准的空白 DB 套用 migration chain 和合成 fixtures；明確檢查 schema grants、RLS、service-only functions、private storage 及跨角色隔離。[Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
- [ ] 用兩條真 DB 連線驗證 refresh lease/CAS、撤銷與保存競態、原 grant 清除不影響新 grant、選檔 receipt 重試。Provider 回應仍是合成，不能列為真實 refresh／revoke。
- [ ] 建立獨立每小時維護工作，D1 僅跑 local expiry／retention／待處理計數；provider refresh/revoke 排程維持關閉。先 dry-run，再用明列可棄置 fixtures 演練；批次上限 100，工作重疊不得重複處理。
- [ ] 保留未引用快照 30 日、撤銷未引用快照 24 小時、最小事件 90 日門檻；到期後下一批處理，目標延遲不超過一小時，逾期告警。試點資料結束後七日內清理的範圍須在批准單列明。
- [ ] 演練關閉新授權／讀取、維持本地撤銷與清除；關閉時不誤顯示遠端撤銷成功。隔離整個 restore target 後才匯入完整 tombstone、replay、驗證直接 API／Studio reader；不得只靠 `restore_pending` 宣稱完成。
- [ ] 指定 key／tombstone 獨立保存位置及實際 backup horizon；無法證明刪除紀錄完整或還原隔離時，保持 BLOCKED。所有操作只限批准的可棄置試點 fixtures。

### Task 6：回歸、獨立審查與 D2 交付

**Files:** `docs/review/kocmax-stage-4d/d1/{target,permissions,instagram-blockers,verification,rollback,d2-handoff}.md` 及 `acceptance.csv`。

- [ ] 重跑完整本機 suite、原 active-missions 專項、build、修改範圍 lint、manifest check；skip 和外部環境案例仍逐項記錄。
- [ ] 原訪客、創作者、品牌、reviewer、operator、finance 的關鍵讀寫旅程在試點 fixtures 中核對；不以只讀頁面通過代替原任務修改／核實／一次性測試入帳。
- [ ] 獨立檢查 target、出口、secret、RLS、callback、PDF worker、原修正與停止演練；重大問題不得靠 mock 綠燈關閉。
- [ ] 交付實際 source/deployment/schema/region/app IDs、scopes、帳號名單、fixtures、成本、保留／清理責任及每平台阻礙。D1 結束時 provider activation 仍 false，請求 D2 時才提交指定帳號用途和真實 OAuth 最後確認。

## 7. 測試帳號與資料準備

提案為兩位內部參與者、兩個 workspace、三個隔離 KOCmax creator 身份；不複製 production 使用者或借用客戶帳號。

| 身份 | D1 準備 | D2 批准後測試 |
| --- | --- | --- |
| A / C1 / W1 | 空白 app fixture；記錄合法擁有人／候選 Google A、IG Creator | 成功路徑、選定繁中 Doc/text/PDF、私人 Brief |
| B / C2 / W1 | 獨立 app fixture；候選 Google B、IG Business | 同 workspace 隔離、低資料／部分權限、共享但權利未知的文件 |
| A / C3 / W2 | 獨立 app session；候選相同 Google A | 跨 workspace 選檔與撤銷範圍，不共享 token／cache |
| 品牌／Reviewer／Operator／Finance | 原角色的合成資料及測試帳本 | 只見明確轉存的任務投影，不見私人來源 |
| 訪客／不在名單者／錯角色 | 負面 fixture | 直接 API／RPC／UI 拒絕 |

D1 可以設定 app 測試者名單及合成 app Auth fixtures；不自動寄邀請或索取密碼。平台擁有人在必要時自行完成控制台邀請接受及 D2 授權。帳號顯示名稱、OAuth client scope 或 app role 均不替代真實身份映射證據。

文件以無客戶資料的自製繁中內容為主；負面 fixtures 包含未選檔、B 分享的 view-only 檔、撤權／改版／不可下載／trash、超過上限、第六檔、損壞／加密／掃描 PDF、假指令。建立或更改真正 Drive 檔案由 D2 核准的檔案擁有人執行；D1 僅準備本機內容清單。

## 8. D1 完成條件與停止條件

| 門檻 | D1 必須交付的證據 |
| --- | --- |
| 隔離 | source、artifact、deployment、DB、origin、OAuth project/app 一致；沒有 production alias、資料或 key；非核准 target 拒絕 |
| 關閉狀態 | 真實 authorize／token／content 操作及 Picker SDK 均未啟用；合成外出請求檢查證明沒有 production／provider account egress |
| 權限 | 只登記指定 scopes；server secrets 無前端洩漏；普通 JWT/RLS 正反例與直接 API/RPC 通過 |
| 可用性 | callback 公開面不暴露私人資料，原任務可用，六寬度檢查與 IAB 手機／桌面回歸通過 |
| Runtime | 實際 PDF worker 封裝、重啟 keyring、兩 DB 連線 lease、日誌遮蔽、維護和隔離還原有證據 |
| Instagram | IG-01/02/03/04 各有已確認契約／配置證據或保留 BLOCKED；未解除不得進入 IG D2 |
| 交接 | owner、費用、取消方法、回退、保留時間及 D2 指定帳號範圍完整；所有 live 驗收仍 NOT RUN |

任何 production target／secret 命中、非名單帳號可讀私人資料、code/token 進 logs、無法停止出網、資料重現或未核對 migration，立即停止。先關新授權與讀取、保留可用的本地撤銷／刪除及稽核，隔離 target，再按批准的回退程序處理；不擅自刪除全部環境或移除有用的證據。

建議工期：批准所需資料齊備後 **3–5 個工程工作天**，不包括 Meta 支援／App Review 或供應商等待。這比原先純環境配置的 1–2 日估算完整，已納入仍欠的 runtime、公開 callback、PDF worker、真 Auth/RLS、維護與回退驗證。D2 另需至少八日自然時間；D1 不宣告 `4D-read-pilot PASS`。

## 9. 批准範圍與執行前必備資料

建議下一次批准限於：**同分支 D1 接線、明列的隔離資源及關閉 provider 的部署、合成資料與隔離 DB/Auth 驗證；不含任何真實 Instagram／Google 帳號 grant、內容讀取、發文／發信／改檔、外部 AI 或 production。** 採逐包實作與獨立審查，沿用上一階段的工作方式。

資源操作前須有：資源擁有人／組織、批准的固定 HTTPS origin、實際 app／DB／log／backup 區域、費用上限、參與者與角色名單、取消及資料清理負責人。新資源生成 ID 後寫入同一份 target receipt，核對後才部署／套用 schema；未知值不能用示例 ID 代替。只需名稱與識別碼，不在聊天提供密碼、token 或 secret。

本次交付即此計劃。D0 的 3,004 passed／363 skipped 等結果維持為 D0 歷史證據；這次沒有執行程式或遠端驗收，亦沒有建立任何真實連接。
