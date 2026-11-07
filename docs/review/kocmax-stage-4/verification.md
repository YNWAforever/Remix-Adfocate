# KOCmax Stage 4A–4C：本機模擬連接驗證

日期：2026-10-31 HKT。分支：`codex/kocmax-studio-stages-1-2`。基準：`27353a36705ab9c2ae039a8f60c31c9e70afbfee`。

本期依批准範圍實作 Instagram「成效雷達」及 Google Drive「靈感背包」的 mock 流程。沒有部署、push、merge、真實 OAuth、外部模型或遠端資料庫操作。三份新增 migration 只在本機 PGlite 驗證。正式開關預設關閉，production 拒絕 mock 執行。

## 已實作的範圍

| 階段 | 本機實作 | 保留的原行為 |
| --- | --- | --- |
| 4A | 私人連接與安全 DTO、一次性模擬授權、部分授權、加密模擬憑證、generation、刷新與撤銷、停用時仍可管理帳號 | 不改原登入、角色範圍及公開 social 投影；不自動遷移舊帳號 |
| 4B | 可注入的兩個 mock provider、Instagram 成效缺值／30日媒體選取／50項上限／冷卻、Drive 明確選檔／5檔／5MiB／8000字元、版本與權利檢查 | 未連接仍可做基本任務；沒有發文、私訊、檔案修改或其他平台連接 |
| 4C | 本討論的私人來源、獨立處理／AI／分享同意、來源證據、Brief 保存及逐段轉存、一次性許可、匯出／撤銷／清除及保留規則 | 任務審批、發佈證明、完成核實、凍結 reward contract、獎勵交接與帳本仍由原流程處理 |

連接、同步、聊天和重複匯入不發積分或 XP。模擬來源保留 `sample_only`、未驗證狀態、實際問題、平台、時間、版本及引用。未知地區／語言／指標不補零、不換成其他地區資料。

來源用途分開確認。沒有處理權利只匯入權限提示；沒有 AI 同意不進入模型上下文；未知轉分享權不能靠勾選框變成可分享。分享檢查從已保存 Brief 解析來源，許可綁定內容、接收任務、版本、owner 和 generation，落地前再驗。

## 功能保留與審查

新增 schema 為三份 additive migration。原 `studio_command` 移至 private schema 作受控委派，保留既有手動來源、版本衝突、idempotency 及任務轉存語意；原 migration、settlement 函式、套件 lockfile、production entry 和部署設定沒有重寫。

獨立審查發現並要求修正：SQL 的 read permit 合約、sync-run 匯出排序、到期帳號撤銷／刪除、重新連接後的資源 identity，以及撤銷來源後對話顯示。修正以實際 service → PGlite 及針對測試覆蓋；最終複查狀態於下方驗證紀錄記載。

因舊 message DTO 沒有逐來源 lineage，撤銷後會保守隱藏撤銷之前的 assistant 回覆；保留使用者輸入及撤銷後新的安全回覆。私人 Brief 只遮蔽引用被撤銷來源的段落。刪除會清除相關衍生內容，但不承諾收回已交付的任務副本。

## 執行證據

| 檢查 | 結果與界線 |
| --- | --- |
| 最後完整回歸 | 300 files / 2,710 tests 通過，44 files / 363 tests 原有略過，1 test 失敗：新增 manifest 後原 preflight 合約數量未登記。已列明 69 項新增 capability、保留原 620/598/587 合約及每項 validator，針對重跑通過。即本次完整集合的 2,711 個執行案例全部解決；沒有把略過計成通過 |
| 修正後針對回歸 | 6 files / 54 tests 通過：preflight、manifest、StudioWorkspace、studio policy、integration evidence、preview。這是最後小修改後的針對重跑，沒有冒稱重新跑過整套 |
| 原任務／獎勵回歸 | `test:active-missions`：19 files / 485 tests 通過，46 項原有略過 |
| 實際 service → SQL | agent 最後 SQL 集合 71/71 通過、0 skips；另由獨立 reviewer 跑 8 項針對檢查。PGlite 模擬 owner/RLS/事務，不等同真實 JWT/PostgREST 或跨連線生產競態驗收 |
| 最後 build | ESM、TypeScript 與 Vite production build 通過 |
| 最後 lint | 0 errors；4 個原有 hooks warnings（PublicationProofReview、activeMission、onboarding） |
| Release manifest | 由既有工具生成與 check 通過；digest `749bb2105281f95226ece7f84f380ce8e6cc8c3a39f305e83dc55ca9f5543644`。沒有執行真正 release preflight、executor 或遠端 migration |
| Production bundle | 找不到新增 mock provider catalogue、preview session/credential key、MemoryIntegrationRepository、CredentialVault 或本機授權標記 |
| 獨立審查 | 上述五個 P1/P2 問題已修正並逐項複查；沒有剩餘 actionable P1/P2 finding |
| Diff | 空白檢查通過；原 migration、settlement、套件與部署設定保留 |

較早的完整初測曾受本機 socket／臨時檔案權限及 manifest 登記影響；允許本機操作後的最後完整測試沒有該類環境失敗。沒有以外部環境變數打開真實整合測試。詳細 logs 留於 ignored 的 `.superpowers/sdd/2026-10-31-kocmax-stage-4-integrations/logs/`。

## 內建瀏覽器

[51 項紀錄 JSON](journey-matrix.json)／[CSV](journey-matrix.csv) 記錄實際路徑、viewport、標題、alerts 及 overflow。主要寬度 390×844、1440×1000；連接頁另抽查 320、430、768、1024px。所有紀錄沒有文件層橫向溢出。

- 桌面：取消／部分授權、同步及冷卻、Instagram 缺值和真實 0、自有 Drive 選檔、分開同意、兩來源私人對話、保存 Brief、分享預覽。
- 手機：完整 Drive 授權／取消／選檔、權利未知文件的私人提示、AI 與分享獨立選項、Brief 轉存原任務、必填 checklist、提交 v1、待結算和已入帳；一鍵撤銷、繼續安全對話、重連同檔、取消及確認清除。
- 原任務：來源 caption 保留問題／平台／時間／引用；模擬結算後 400 積分入帳，首頁餘額 200→600，XP 保持 800。結算前沒有新增獎勵。這只驗證示例事件的呈現。
- 權限拒絕 → 後續服務失敗：兩種版面均不恢復私人帳號快取。Escape 關閉授權視窗並把焦點還給啟動按鈕。減少動畫由 CSS／元件檢查驗證，沒有宣稱實機 OS 偏好測試。
- 11 個原頁面在兩種主要寬度各檢查一次：訪客首頁、登入、新人設定、任務、獎賞、個人頁、品牌任務、營運作者、審稿隊列、財務交接、CMS。Finance viewer 仍唯讀。這 22 項是入口與版面回歸，沒有把每個角色的所有 mutation 都重跑一次。

手機驗證找出的固定示例時間問題已修正為實際操作時間，並重新驗證「撤銷後舊回覆隱藏、本人輸入保留、新回覆可用」。瀏覽器開發熱更新期間的中斷不列為通過紀錄。最後瀏覽器錯誤日誌為空。

| 桌面 | 手機 |
| --- | --- |
| [已連接帳號](screenshots/desktop-connections.jpg) | [技能收藏](screenshots/mobile-connections.jpg) |
| [私人對話](screenshots/desktop-conversation.jpg) | [授權說明](screenshots/mobile-drive-consent.jpg) |
| [指定選檔](screenshots/desktop-drive-picker.jpg) | [指定選檔](screenshots/mobile-drive-picker.jpg) |
| [逐段分享](screenshots/desktop-brief-sharing.jpg) | [逐段分享](screenshots/mobile-brief-sharing.jpg) |
| [部分授權](screenshots/desktop-partial.jpg) | [撤銷後仍可討論](screenshots/mobile-after-revoke.jpg)／[清除](screenshots/mobile-purge.jpg) |
| [CMS](screenshots/desktop-content.jpg) | [CMS](screenshots/mobile-content.jpg)／[原任務已入帳](screenshots/mobile-task-settled.jpg) |

## 本機預覽

以 `node scripts/studio-dev.mjs` 啟動，網址為 `http://127.0.0.1:8772/`。頂部控制列可切換示例角色、畫面、資料狀態及模擬伺服器事件。網頁使用真實 React 元件與同一套 mock integration service；資料只在記憶體，重載會重設。角色切換是示例控制，不是真實登入。所有 provider 與示例模型運算在本機，外部 fetch 被拒絕。

預覽的任務結算事件只驗證 UI 與接合；它不是正式積分、真實後端核實、Auth/RLS 或 provider 驗收。

## 未執行及下一個批准範圍

- 真實 Instagram OAuth、Meta API 版本／metric matrix／App Review；此回合未能重新取得 Meta 詳細官方頁，manifest 的 live API version 明確為 null。
- Google 官方 OAuth／Picker、真實檔案下載／export／安全 PDF parser。PDF 示範是已抽取的示例文字。
- 真實平台 token／ACL／撤權 callback、持久金鑰管理、真實 JWT／PostgREST 隔離、OS／跨瀏覽器登入返回。
- 遠端 migration、背景清除排程、備份還原及模型處理商／資料區域／保留合約；沒有宣稱零保留或香港託管。
- 正式部署及外部寫入功能仍需要各自批准。本機批准不會自動啟用以上項目。

詳見 [provider 能力邊界](provider-capabilities.md)、[私人資料運作規則](privacy-runbook.md) 及 [執行計畫](../../superpowers/plans/2026-10-31-kocmax-stage-4-integrations.md)。原 Stage 3 全頁覆蓋紀錄保留於原目錄，沒有當成本期的瀏覽器驗收結果。
