# KOCmax 現有功能與最新更新覆核

日期：2026-10-31 HKT。基準 main `a20b29e2691929f47b26ea9505082bb0882fc404`。

## 覆核範圍與證據層

- GitHub：#66／#67／#68／#69／#70、branches/PRs、100 條最新 commit metadata 與本機完整 306 提交清單。#65 未合併，本機舊分支不可當 main。
- #68 後 43 提交、135 變更檔案；全部 path／commit 已列附件。重要行為讀取 pinned source／migration／測試定義，53 findings 全量分類。未聲稱逐行安全審計所有 306 歷史提交。
- 獨立 reference clone，只讀研究；沒有改產品 source、DB 或 real connection。圖譜工具 list/index 無回應後，按規則改用局部檔案與文字搜尋。
- IAB：公開首頁、creators、瀏覽任務→登入已實查。登入後創作者／營運路徑是 source/CI 層確認，未取得當前登入 session。
- 最新 [CI run 41108911098](https://github.com/YNWAforever/Remix-Adfocate/actions/runs/41108911098) 的 integration、build-test 成功。本次未重跑單元／DB suite；Claude 報告的 2,423 tests、87 migrations、14 browser tests 是其報告，不能當本次實測。
- 正式 deployment 等價、9 新 migration 是否套用、production ACL、SMTP、OAuth/provider 覆蓋仍未驗證。

## 重大更新如何影響設計

| 更新 | 證據 | 對重製的要求 |
|---|---|---|
| Active 結算 | [supabase/migrations/20261029130000_reward_settlement.sql](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/supabase/migrations/20261029130000_reward_settlement.sql) | admin 才可結算；pending/settled/paid 分開；交易去重 |
| 接受申請固定合約 | [supabase/migrations/20261029120000_application_reward_contract.sql](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/supabase/migrations/20261029120000_application_reward_contract.sql) | 保存當時 points/cash；XP 此路徑為 0；不追溯改價 |
| 能力矩陣 | [server/lib/staffCapabilities.ts](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/server/lib/staffCapabilities.ts) | reviewer 無 application/completion，finance 無 settle；單 workspace |
| 品牌 API guard | [server/routes/brand.ts](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/server/routes/brand.ts) | 現金 publish 403，不是現有待審批狀態 |
| 匯出／匿名化 | [server/routes/account.ts](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/server/routes/account.ts) | 保留新流程，新增成果／連接資料也必須加入清理範圍 |
| XP 等級 | [src/lib/levels.ts](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/lib/levels.ts) | 保留 L0–L6 門檻，不加入自訂經濟規則 |

## 53 findings 對照

「來源已修」表示 pinned source／合併修復記錄已包含相應修正，不代表正式環境已驗證。原始 severity 是 Claude 在 #68 baseline 的評級，不是現在的風險分數。其餘項目有些是建議／待實測，不應全部說成已確認漏洞。

| Finding | 原嚴重度 | 本次分類 | 目前影響與計畫 |
|---|---|---|
| F-001 | **Critical** | 來源已修 | PATCH 匯出與 method contract test |
| F-002 | High | 來源已修 | 公共 passport 聯絡型名稱遮罩 |
| F-003 | High | 來源已修 | 品牌寫入 API／非負獎勵約束／現金發佈 guard |
| F-004 | High | 來源已修 | Legacy 決定必填原因、角色檢查、audit |
| F-005 | High | CI 已通過 | 最新 head integration 與 build-test CI 已成功；不是正式環境驗收 |
| F-006 | **Critical** | 部分修復 | 文案不再承諾提款；實際 payout 仍沒有 |
| F-007 | High | 來源已修 | pending → settled 凍結合約結算 |
| F-008 | High | 來源已修 | 版本化 consent gate／optional marketing |
| F-009 | High | 來源已修 | 全量資料匯出／可恢復匿名化與 receipts scrub |
| F-010 | High | 部分修復 | 退件原因與 closed 文案已修；終局拒絕後重新提交仍需政策 |
| F-011 | Medium | 仍需排程／驗證 | 客服表格不送出，新增 case 流程或保留真實電郵 |
| F-012 | High | 來源已修 | 退修通知與 active deadline reminders |
| F-013 | Medium | 仍需排程／驗證 | 營運提醒／SLA 與分派仍需規劃 |
| F-014 | Medium | 來源已修 | 媒體實際格式檢查與 5MB 上限 |
| F-015 | Medium | 仍需排程／驗證 | staff／invite／gift APIs 缺完整操作介面 |
| F-016 | Medium | 部分修復 | 按角色 landing 已修；財務 KPI 權限隔離仍需補 |
| F-017 | Medium | 仍需排程／驗證 | 正式停權／復權命令與政策未完成 |
| F-018 | Medium | 來源已修 | onboarding 可開 guide/profile 與登出 |
| F-019 | Low | 仍需排程／驗證 | 公開任務 CTA 實查仍導登入；新增 public projection |
| F-020 | Medium | 來源已修 | 創作者日期與截止 HKT |
| F-021 | Medium | 來源已修 | bootstrap 缺 balance row 回可重試 503 |
| F-022 | High | 來源已修 | loaded version／expected_updated_at 與 conditional publish |
| F-023 | Medium | 仍需排程／驗證 | LLM match／hook rate limit 需處理 |
| F-024 | Medium | 仍需排程／驗證 | 不支援平台的驗證死路／編輯重設驗證需修 |
| F-025 | Medium | 仍需排程／驗證 | 申請、提交、拒絕、過期與歷史標籤需統一 |
| F-026 | Medium | 來源已修 | 活動詳情 404／錯誤／重試 |
| F-027 | Medium | 仍需排程／驗證 | proof 介面英語與手機 CTA 遮擋需處理 |
| F-028 | Low | 部分修復 | profile／JSON 邊界已修；其他 write schemas 不完整 |
| F-029 | Medium | 來源已修 | 錢包 loading/error 不填假 0，正負號修正 |
| F-030 | Low | 仍需排程／驗證 | signup mode、email policy、已登入重導需核對 |
| F-031 | Low | 仍需排程／驗證 | 沒有 writer 的狀態及未使用 deadline 需定案 |
| F-032 | High | 部分修復 | safe error／global onError 已修；告警與外部追蹤仍需做 |
| F-033 | Medium | 仍需排程／驗證 | landmark、label、未讀替代文字及 loader a11y |
| F-034 | Low | 仍需排程／驗證 | staff next 深連結、邀請驗證與 token 儲存 |
| F-035 | Medium | 仍需排程／驗證 | session 過期／brand logout／staff MFA |
| F-036 | Medium | 待正式驗證 | SMTP、redirect allow-list、migration tracker 正式設定未驗證 |
| F-037 | Low | 仍需排程／驗證 | 已決定 legacy 個案不應顯示可再次決定動作 |
| F-038 | High | 來源已修 | 接受 application 固定 reward contract |
| F-039 | Medium | 仍需排程／驗證 | 預算充值 UI／去重及積分成本政策 |
| F-040 | Low | 仍需排程／驗證 | join mutateAsync 失敗處理 |
| F-041 | Medium | 仍需排程／驗證 | gift code 庫存原子性、physical/refund／legacy request id |
| F-042 | Low | 仍需排程／驗證 | proof DNS rebinding／storage grant expiry 硬化 |
| F-043 | Low | 仍需排程／驗證 | shortlist 不覆寫既有狀態、audit 原子性 |
| F-044 | Low | 仍需排程／驗證 | 逐內容成效能力尚不足 |
| F-045 | Medium | 仍需排程／驗證 | bulk／export／品牌結果視圖為缺口 |
| F-046 | **Critical** | 來源已修 | 大量佇列分頁與 lookup 分批 |
| F-047 | Medium | 來源已修 | KB global 或本人 workspace 的讀取範圍 |
| F-048 | Low | 來源已修 | assistant 歷史禁止 client 偽造寫入 |
| F-049 | High (if true) | 待正式驗證 | production ACL 需要真實環境驗證，不能宣稱已證實漏洞 |
| F-050 | Low | 仍需排程／驗證 | 舊文檔、All workspaces 註解與 dead route 清理 |
| F-051 | Low | 仍需排程／驗證 | 廣泛 DB default grants 的最小權限硬化 |
| F-052 | Medium | 仍需排程／驗證 | legacy 決定 audit 已補；其他金額／access／content audit 仍不完整 |
| F-053 | Medium | 來源已修 | Manage panel 拒絕申請傳送必填原因 |

分類：21 項已有來源修復或最新 CI 證據、5 項部分修復、27 項待排程／進一步驗證。其中 F-049 只可列 production 未驗證。

## 功能保留對照（使用者能力）

| 既有功能 | 新入口／設計 | 保留與新增界線 |
|---|---|---|
| 公開首頁、creators、brands、earn | 公開四種價值／玩法頁 | 去除未核實成效承諾；保留網址 |
| packages／stories／playbooks／contact／legal | 公開資源與聯絡 | contact 無送出能力，不假裝成功 |
| password、magic link、reset、OAuth/OTP flags | 登入／最小 onboarding | 不新增未驗證供應商可用性 |
| bootstrap／workspace | 恢復與角色 landing | 缺 balance row 可重試；單 workspace |
| consents／marketing | 新手同意／私隱 | 保留版本 gate，marketing 預設自願 |
| profile、avatar、媒體、categories | 我的檔案 | 資料格式及邊界保留 |
| IG／Threads 擁有權驗證與 snapshots | 社交驗證 | 保留 BioCode；OAuth 成效權限另設 |
| mission 探索／詳情／資格 | 任務板／任務卡 | 直接導航；public teaser 另增投影 |
| 申請、接受、婉拒／quota | 任務加入／申請佇列 | freeze contract、reasons、first-writer-wins |
| legacy 提交／補充／approve/reject | 我的任務＋legacy review | 原交易發獎；不搬進 active settlement |
| active draft／assets／versions／revisions | 任務工作區／獨立 Brief | 原 workflow/item/draft version 仍權威 |
| fulfillment／shipping | 任務交付路線及營運個案 | 有寄送需求時依原分支流程 |
| publication instructions／proof attempts／metadata／reviews | 證明子頁／營運 proof queue | 保留所有嘗試與人工核實；不是自動發佈 |
| completion eligibility／reward contract backfill | 完成資格檢查 | 缺合約不能編造，人工 backfill 有證據 |
| pending/cancelled/settled、通知重試、處理目標 | 獎勵入帳佇列／錢包 | 結算依原 RPC，finance viewer 唯讀 |
| points、cash ledger、earnings history | 積分與入帳記錄 | 沒有 payout；未知不填零 |
| gift catalog、redemption intent／codes／history | 收藏卡商店與紀錄 | 保留去重；physical/refund 另排 |
| XP／levels／passport／分享token | 角色進度、名片、徽章 | 原 XP 門檻不變；新徽章需事件規則 |
| campaign missions／leaderboard／snapshots／settlement | 活動／挑戰／結果 | opt-in 隱私與好友挑戰為新增 |
| match／copilot hook／assistant KB | 對話範本＋原直接入口 | server-written history／KB isolation 不回歸 |
| guide docs／tracks／lessons／progress | 成長學院 | 保留進度與單元 route |
| news／content／notifications | 消息與通知 | 保留已讀、實體 deep link、HKT |
| account export／delete | 帳號與私隱 | 可恢復匿名化；財務 audit 保留 |
| staff identity／capabilities／role landing | 營運首頁 | 預設 deny；不用純 frontend 控權 |
| creator review／case／notes／proof navigation | 營運創作者個案 | 私人上下文不進個案 |
| CRM／radar／engaged／shortlist／邀請狀態 | 創作者 CRM 分頁 | 現有狀態不覆寫，atomicity 缺口排程 |
| mission CRUD／duplicate／publish／close／manage | 任務編輯器與狀態卡 | loaded version／409 與角色限制保留 |
| campaign CRUD／publish／mission links／close／settle | 活動編輯器 | 不改資金與積分語義 |
| insights／queue pagination | 營運洞察／卡片佇列 | reviewer 財務隔離待補；列表不截掉後段 |
| staff access／brand invite API | 權限與邀請頁 | 新 UI，不是新 API 已上線證明 |
| gift-code upload API／workspace budget RPC | 庫存／預算頁 | UI、原子性、充值去重為新工作 |
| CMS content／media／schedule／publish／archive | 消息內容編輯 | content_editor；magic byte／5MB保留 |
| Academy CMS／lesson CRUD／publish／archive | 學院內容編輯 | 平台內容能力分開 |
| brand invitation/login／mission CRUD／resources | 品牌合作空間 | cash publish guard 保留；正式送審新增 |
| brand results／support cases | 品牌成果／客服 | 目前缺口，新資料與權限投影 |
| cron／social refresh／notifications／audit | 背景服務＋可理解結果 | 前端改造不能破壞 cron authorization 或事件 |

## 全量前端路由去向

82 條路由定義包含 layout/index；原網址保留，以下列新的畫面家族。細分任務、文章、課程內容以相同家族填入實際資料。

| 現有 router id | 新畫面 | 保留來源 |
|---|---|---|
| `/_app/auth/callback` | `a-login` · 登入／建立帳戶 | [src/routes/_app.auth.callback.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.auth.callback.tsx) |
| `/_app/auth/reset-password` | `a-reset` · 重設密碼 | [src/routes/_app.auth.reset-password.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.auth.reset-password.tsx) |
| `/_app/campaigns/$slug` | `c-campaign` · 活動與好友挑戰 | [src/routes/_app.campaigns.$slug.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.campaigns.%24slug.tsx) |
| `/_app/campaigns/` | `c-campaigns` · 每日／每週／活動 | [src/routes/_app.campaigns.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.campaigns.index.tsx) |
| `/_app/campaigns` | `c-campaigns` · 每日／每週／活動 | [src/routes/_app.campaigns.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.campaigns.tsx) |
| `/_app/explore` | `c-missions` · 任務探索 | [src/routes/_app.explore.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.explore.tsx) |
| `/_app/guide/doc/$slug` | `c-lesson` · 課程單元 | [src/routes/_app.guide.doc.$slug.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.guide.doc.%24slug.tsx) |
| `/_app/guide/` | `c-guide` · 成長學院 | [src/routes/_app.guide.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.guide.index.tsx) |
| `/_app/guide/track/$trackId` | `c-lesson` · 課程單元 | [src/routes/_app.guide.track.$trackId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.guide.track.%24trackId.tsx) |
| `/_app/home` | `c-home` · 創作者工作室 | [src/routes/_app.home.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.home.tsx) |
| `/_app/login` | `a-login` · 登入／建立帳戶 | [src/routes/_app.login.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.login.tsx) |
| `/_app/match` | `c-templates` · 10 張任務範本 | [src/routes/_app.match.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.match.tsx) |
| `/_app/mission/$missionSlug` | `c-task` · 我的任務／交付 | [src/routes/_app.mission.$missionSlug.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.mission.%24missionSlug.tsx) |
| `/_app/mission/` | `c-missions` · 任務探索 | [src/routes/_app.mission.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.mission.index.tsx) |
| `/_app/mission` | `c-missions` · 任務探索 | [src/routes/_app.mission.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.mission.tsx) |
| `/_app/more` | `c-more` · 所有功能 | [src/routes/_app.more.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.more.tsx) |
| `/_app/my/$submissionId` | `c-task` · 我的任務／交付 | [src/routes/_app.my.$submissionId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.my.%24submissionId.tsx) |
| `/_app/my/` | `c-task` · 我的任務／交付 | [src/routes/_app.my.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.my.index.tsx) |
| `/_app/my` | `c-task` · 我的任務／交付 | [src/routes/_app.my.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.my.tsx) |
| `/_app/news/$slug` | `c-news` · 消息與文章 | [src/routes/_app.news.$slug.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.news.%24slug.tsx) |
| `/_app/news/` | `c-news` · 消息與文章 | [src/routes/_app.news.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.news.index.tsx) |
| `/_app/notifications` | `c-notifications` · 通知中心 | [src/routes/_app.notifications.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.notifications.tsx) |
| `/_app/onboarding` | `a-onboarding` · 新手設定與同意 | [src/routes/_app.onboarding.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.onboarding.tsx) |
| `/_app/passport` | `c-passport` · 名片與徽章 | [src/routes/_app.passport.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.passport.tsx) |
| `/_app/privacy` | `c-privacy` · 帳號與私隱 | [src/routes/_app.privacy.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.privacy.tsx) |
| `/_app/profile` | `c-profile` · 個人檔案 | [src/routes/_app.profile.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.profile.tsx) |
| `/_app/redemption/history` | `c-redemptions` · 兌換紀錄 | [src/routes/_app.redemption.history.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.redemption.history.tsx) |
| `/_app/redemption/` | `c-shop` · 獎賞商店 | [src/routes/_app.redemption.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.redemption.index.tsx) |
| `/_app/redemption` | `c-shop` · 獎賞商店 | [src/routes/_app.redemption.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.redemption.tsx) |
| `/_app/tnc` | `v-legal` · 條款與私隱 | [src/routes/_app.tnc.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.tnc.tsx) |
| `/_app` | `c-home` · 創作者工作室 | [src/routes/_app.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.tsx) |
| `/_app/wallet/earnings` | `c-wallet` · 積分與入帳記錄 | [src/routes/_app.wallet.earnings.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.wallet.earnings.tsx) |
| `/_app/wallet` | `c-wallet` · 積分與入帳記錄 | [src/routes/_app.wallet.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_app.wallet.tsx) |
| `/_site/brands` | `v-brands` · 品牌合作首頁 | [src/routes/_site.brands.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.brands.tsx) |
| `/_site/contact` | `v-contact` · 聯絡與求助 | [src/routes/_site.contact.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.contact.tsx) |
| `/_site/creators` | `v-creators` · 創作者玩法 | [src/routes/_site.creators.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.creators.tsx) |
| `/_site/earn` | `v-earn` · 積分與獎勵玩法 | [src/routes/_site.earn.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.earn.tsx) |
| `/_site/` | `v-home` · 公開首頁 | [src/routes/_site.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.index.tsx) |
| `/_site/legal/privacy` | `v-legal` · 條款與私隱 | [src/routes/_site.legal.privacy.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.legal.privacy.tsx) |
| `/_site/legal/terms` | `v-legal` · 條款與私隱 | [src/routes/_site.legal.terms.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.legal.terms.tsx) |
| `/_site/packages` | `v-packages` · 合作方案 | [src/routes/_site.packages.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.packages.tsx) |
| `/_site/playbooks` | `v-playbooks` · 公開創作資源 | [src/routes/_site.playbooks.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.playbooks.tsx) |
| `/_site/stories` | `v-stories` · 作品故事 | [src/routes/_site.stories.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.stories.tsx) |
| `/_site` | `v-home` · 公開首頁 | [src/routes/_site.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/_site.tsx) |
| `/admin/academy/$id` | `o-academy` · 學院內容編輯 | [src/routes/admin.academy.$id.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.academy.%24id.tsx) |
| `/admin/academy/` | `o-academy` · 學院內容編輯 | [src/routes/admin.academy.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.academy.index.tsx) |
| `/admin/active-missions/$workflowId` | `o-active` · Active 草稿審核 | [src/routes/admin.active-missions.$workflowId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.active-missions.%24workflowId.tsx) |
| `/admin/active-missions/` | `o-active` · Active 草稿審核 | [src/routes/admin.active-missions.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.active-missions.index.tsx) |
| `/admin/active-missions` | `o-active` · Active 草稿審核 | [src/routes/admin.active-missions.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.active-missions.tsx) |
| `/admin/applications` | `o-applications` · 任務申請審核 | [src/routes/admin.applications.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.applications.tsx) |
| `/admin/campaigns/$id` | `o-campaigns` · 活動管理 | [src/routes/admin.campaigns.$id.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.campaigns.%24id.tsx) |
| `/admin/campaigns/` | `o-campaigns` · 活動管理 | [src/routes/admin.campaigns.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.campaigns.index.tsx) |
| `/admin/campaigns/new` | `o-campaigns` · 活動管理 | [src/routes/admin.campaigns.new.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.campaigns.new.tsx) |
| `/admin/content/$id` | `o-cms` · 消息內容編輯 | [src/routes/admin.content.$id.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.content.%24id.tsx) |
| `/admin/content/` | `o-cms` · 消息內容編輯 | [src/routes/admin.content.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.content.index.tsx) |
| `/admin/creators` | `o-people` · CRM／Radar／Engaged | [src/routes/admin.creators.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.creators.tsx) |
| `/admin/engaged` | `o-people` · CRM／Radar／Engaged | [src/routes/admin.engaged.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.engaged.tsx) |
| `/admin/` | `o-home` · 營運待辦首頁 | [src/routes/admin.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.index.tsx) |
| `/admin/insights` | `o-insights` · 工作成果與洞察 | [src/routes/admin.insights.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.insights.tsx) |
| `/admin/missions/$missionId` | `o-editor` · 任務編輯器 | [src/routes/admin.missions.$missionId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.missions.%24missionId.tsx) |
| `/admin/missions/` | `o-missions` · 任務管理 | [src/routes/admin.missions.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.missions.index.tsx) |
| `/admin/missions/new` | `o-editor` · 任務編輯器 | [src/routes/admin.missions.new.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.missions.new.tsx) |
| `/admin/radar` | `o-people` · CRM／Radar／Engaged | [src/routes/admin.radar.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.radar.tsx) |
| `/admin/reward-handoffs` | `o-rewards` · 獎勵結算 | [src/routes/admin.reward-handoffs.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.reward-handoffs.tsx) |
| `/admin/submissions` | `o-submissions` · 直接交成果審核 | [src/routes/admin.submissions.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.submissions.tsx) |
| `/admin` | `o-home` · 營運待辦首頁 | [src/routes/admin.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/admin.tsx) |
| `/brand/` | `b-home` · 品牌合作首頁 | [src/routes/brand.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.index.tsx) |
| `/brand/missions/$missionId` | `b-editor` · 品牌任務編輯 | [src/routes/brand.missions.$missionId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.missions.%24missionId.tsx) |
| `/brand/missions/` | `b-missions` · 品牌任務清單 | [src/routes/brand.missions.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.missions.index.tsx) |
| `/brand/missions/new` | `b-editor` · 品牌任務編輯 | [src/routes/brand.missions.new.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.missions.new.tsx) |
| `/brand/resources/$slug` | `b-resources` · 品牌資源 | [src/routes/brand.resources.$slug.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.resources.%24slug.tsx) |
| `/brand/resources/` | `b-resources` · 品牌資源 | [src/routes/brand.resources.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.resources.index.tsx) |
| `/brand` | `b-home` · 品牌合作首頁 | [src/routes/brand.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand.tsx) |
| `/brand_/auth/callback` | `b-invite` · 品牌邀請與帳戶 | [src/routes/brand_.auth.callback.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand_.auth.callback.tsx) |
| `/brand_/login` | `b-invite` · 品牌邀請與帳戶 | [src/routes/brand_.login.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/brand_.login.tsx) |
| `/operator/creators/$creatorId` | `o-case` · 創作者完整個案 | [src/routes/operator.creators.$creatorId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.creators.%24creatorId.tsx) |
| `/operator/creators/` | `o-people` · CRM／Radar／Engaged | [src/routes/operator.creators.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.creators.index.tsx) |
| `/operator/creators` | `o-people` · CRM／Radar／Engaged | [src/routes/operator.creators.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.creators.tsx) |
| `/operator/` | `o-home` · 營運待辦首頁 | [src/routes/operator.index.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.index.tsx) |
| `/operator/missions/$missionId` | `o-people` · CRM／Radar／Engaged | [src/routes/operator.missions.$missionId.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.missions.%24missionId.tsx) |
| `/operator` | `o-home` · 營運待辦首頁 | [src/routes/operator.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/operator.tsx) |
| `/passport/$token` | `v-passport` · 公開創作者名片 | [src/routes/passport.$token.tsx](https://github.com/YNWAforever/Remix-Adfocate/blob/a20b29e2691929f47b26ea9505082bb0882fc404/src/routes/passport.%24token.tsx) |

## 可重查附件

直接開啟：[306 次提交](C:/Users/laich/.codex/visualizations/2026/10/29/01a1880d-a6f1-7ef1-9ec1-f853a3b65772/review-20261031/main-commits.csv) · [43 次近期更新](C:/Users/laich/.codex/visualizations/2026/10/29/01a1880d-a6f1-7ef1-9ec1-f853a3b65772/review-20261031/recent-fix-commits.csv) · [近期 135 個變更檔案](C:/Users/laich/.codex/visualizations/2026/10/29/01a1880d-a6f1-7ef1-9ec1-f853a3b65772/review-20261031/recent-changed-files.csv) · [本次驗證紀錄](C:/Users/laich/.codex/visualizations/2026/10/29/01a1880d-a6f1-7ef1-9ec1-f853a3b65772/review-20261031/verification.md)。

共同祖先至 main 的完整清單有 3,491 個檔案，其中 2,853 個在 docs。這個數字包含文件與歷史整合，不等於 3,491 個功能改動；近期產品行為以 #68 後的 135 paths 與 current source 為重點。

提交與檔案清單在同一任務的 `review-20261031` 資料夾：

- `main-commits.csv`：306 個提交，完整 SHA／作者時間／主題。
- `main-changed-files.csv`：共同祖先到 main 的完整檔案清單（不依 GitHub compare 的 300-file cap）。
- `recent-fix-commits.csv`：#68 後 43 個提交。
- `recent-changed-files.csv`：#68 後 135 個變更檔案。
- `existing-route-inventory.csv`：82 個 createFileRoute 定義。
- `api-handler-inventory.csv`：176 個在 route source 中宣告的 slash path handlers；路徑相對各 router，不是最終掛載 URL。
- `claude-findings-original.csv`：53 條原始 register，包含當時證據與建議；必須與本文件的新狀態一起讀。
- `audit-summary.json`：釘住 SHA 與統計。

來源：[#70](https://github.com/YNWAforever/Remix-Adfocate/pull/70)、[#69](https://github.com/YNWAforever/Remix-Adfocate/pull/69)、[#68](https://github.com/YNWAforever/Remix-Adfocate/pull/68)、[#66](https://github.com/YNWAforever/Remix-Adfocate/pull/66)。
