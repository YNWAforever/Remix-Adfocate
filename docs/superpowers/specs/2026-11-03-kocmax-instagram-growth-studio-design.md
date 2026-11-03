# KOCmax 創作者對話工作室：Instagram 圖片理解與成長技能設計

日期：2026-11-03（香港／新加坡時間）

狀態：**待產品負責人審閱的設計**；不授權實作、資料庫變更、真實連接、真實發佈或部署。

目標分支：`codex/kocmax-studio-stages-1-2`。本設計接續 Stage 1–3、Stage 4A–C、D0/D1，保留現有任務、審批、點數、徽章、訪客、品牌與營運流程。

## 1. 意圖、成功與邊界

創作者從一句「幫我看看這張照片適合怎樣發」出發，看懂自己的作品及已授權的 Instagram 成效，得到可執行的下一步，自己上傳下一篇圖片、挑選文案、逐篇確認發佈，並把真實成果交回原任務流程。對話仍是入口；四張技能卡是清楚的捷徑，不能取代自由提問。

首批成功的定義：創作者能在手機與桌面上完成「連接自己的專業 Instagram → 看懂一張已核對來源的圖片 → 根據可用資料檢討貼文 → 上傳自己的下一張圖 → 看預覽並確認 → 取得可核對的發佈回執 → 按原任務規則提交證明」。系統能誠實標出缺失資料、第三方圖片來源、未經證實的成長建議，以及發佈結果不明的情況。衡量首次有用分析、草稿完成率、人工修訂率、發佈成功與未知狀態、錯帳號／重複發佈事故、任務證明退修率；不用停留時間或連續登入天數作主要成效。

**不包含**：Google Drive 真實授權、其他社交平台、個人 Instagram 帳號的官方 Insights／發佈、自動發佈、排程、私訊／留言、廣告、Reels／Stories／輪播發佈、AI 生成圖片、爬取私人帳號、以 Bio 驗證碼代替官方發佈授權、因連接或聊天發可兌換積分。第一批發佈以**單張靜態圖片的 Instagram feed post** 為建造範圍；較多格式可留在設計與資料模型中，但其按鈕顯示「尚未支援」。這是設計者的分期選擇，供負責人審閱。

反目標：沒有連接就不能做基本任務；把 RapidAPI 資料說成 Meta 官方；把缺值填零或套用其他地區成效；以公開圖片當作創作者授權證明；把按下技能卡當作已完成任務；在創作者未見確切內容時發佈；動態效果或連續登入造成使用壓力。

## 2. 已選做法與比較

| 做法 | 利弊 | 決定 |
| --- | --- | --- |
| 只用官方 Instagram Login 取得身分、媒體與指標、發佈 | 來源一致、權限較單純；目前讀取 adapter 沒有圖片內容，圖片理解需新增官方媒體讀取或用戶上傳 | 未選作首批完整方案；保留作第三方圖片不可用時的退路 |
| **混合來源：官方 Instagram Login + RapidAPI 的公開圖片補充** | 官方授權只決定自己的帳號／可用指標／發佈權；RapidAPI 只補充經匹配的公開圖片。能讓圖片診斷先有素材，但多一份供應商權利、品質與來源不一致風險 | **使用者選 B；本文件採用** |
| 只輸入 username，靠 RapidAPI／Bio 碼辨識並發佈 | 可看到一些公開資料，但無法給 KOCmax 官方發佈權或可靠的跨供應商身分關聯 | 排除作為新發佈授權。保留既有 BioCode／社交護照用途，不挪作 Instagram Login 身分 |

技能方面採**四張 KOCmax 自有任務卡**，取材並改寫指定開源 repo 的少量方法；不安裝全部 106 份原始 `SKILL.md`，也不讓其中的 WoopSocial 工具或文字取得執行權。創作者本人上傳新貼文圖片；圖片診斷由 KOCmax 視覺能力實現，開源 repo 的 `image-prompt` 不是圖片理解器。

## 3. 現況與變更界面

- D1 在既有共用 Supabase DB 對九個真實 Auth 帳號完成 265／265 API/RLS 權限案例及手機／桌面登入；精確清理的後置條件已獨立讀回。它沒有建立原先規劃的獨立託管 DB/Auth/Storage，也沒有測試真實 Instagram 連接、真實發佈或條款門檻後的完整創作者任務旅程。[D1 收尾](../../review/kocmax-stage-4d/d1/D1-CLOSEOUT-20261103.md)
- 現有 Instagram adapter 只讀近 30 日、至多 50 筆自有媒體與有限指標／caption／permalink；未讀取或下載圖片位元組。RapidAPI 既有社交掃描主要回傳 username、bio 和最近貼文文字／互動數，也未提供本設計所需的圖片素材管道。兩者都需要明確新增、比對與權利檢查，不能把「已接上」寫成現況。
- 現有工作室對含 integration source 的外部 AI 處理會回 `external_model_not_approved`。現有一般文字模型入口不是圖片理解能力；真實圖片送模型需要新的 processor、同意及評估關口。離線 mock 可先製作完整介面與狀態機。
- 連接服務已採本地先停用、generation 防晚到回寫、再回報 provider 撤權狀態；Instagram provider 的 `DELETE /{id}/permissions` 目前只是候選實作，官方 Instagram Login 契約、subject 對應和通知身分仍未證實。[Instagram 阻斷](../../review/kocmax-stage-4d/d1/instagram-blockers.md)
- 原任務的接單條款與獎勵會凍結；Active 完成後可能先是 `pending`，由有權職員結算成 `settled` 才入帳。部分 Active 合約的 XP 是 0。新介面必須顯示實際合約與結算狀態，不為一次發文額外發點數。[全產品設計](2026-10-31-kocmax-full-product-design.md)

## 4. 創作者旅程與畫面

### 4.1 入口及資訊結構

工作室首頁保持提問框在首屏，提示「問我下一篇怎樣寫」；四張技能卡排在對話旁／下方，已有的任務卡與任務、成果、獎賞、連接帳號導覽保留。不要求先完成帳號連接或品牌聲線設定。未連接時可用自己上傳的圖片、原任務要求與手動證據完成私人分析及基本任務；依賴官方成效、帳號發佈的操作才顯示連接提示。

| 步驟 | 手機（320–430px） | 桌面（約 1440px） | 共同可見內容 |
| --- | --- | --- | --- |
| 連接／選帳號 | 全頁授權說明，返回原討論串 | 連接說明面板，返回原對話 | 實際 IG username、專業帳號資格、授權用途與 scopes、取消／撤銷 |
| 選舊貼文／圖片 | 單欄可展開貼文卡 | 列表＋右側證據詳情 | 官方媒體 ID／permalink／時間；圖片由何處取得、是否精確匹配、缺漏 |
| 圖片理解及技能 | 對話下方一張張結果卡；證據進子頁 | 對話中間，來源與圖片標記側欄 | 看見甚麼、圖片上文字、可能誤讀處、實際指標、下一步建議 |
| 上傳新圖片與文案 | 全頁草稿，保留返回對話 | 草稿與對話並排 | 私人預覽、caption 版本、帳號、合作披露、來源與權利 |
| 確認／發佈 | 獨立確認頁，主按鈕需明確點選 | 明確確認對話框／頁面 | 精確圖片、caption、目標帳號、立即發佈、不可撤回提示 |
| 結果與任務 | 發佈狀態卡接原任務「提交證明」 | 發佈回執＋任務詳情 | Meta media ID/permalink（如有）、時間、結果狀態、原合約點數與待核實 |

手機保留底部提問入口與返回原討論串位置；桌面可同時看對話、圖片與證據，但各主題的 thread context 仍獨立。所有操作有鍵盤焦點、文字狀態、44px 觸控目標與 reduced-motion；完成動畫只慶祝**已核實的原任務結算**，不可讓「發佈成功」動畫冒充積分已入帳。

### 4.2 一條可建造的首批流程

1. 創作者在「已連接帳號」以官方 Instagram Login 授權自己有權管理的專業帳號；伺服器對 grant、scopes、subject、profile、workspace/creator 做核對。username 是顯示名稱／搜尋輔助，不是授權鍵。
2. 創作者從官方媒體清單挑一篇；KOCmax 讀官方可用的 caption／指標與時間範圍。公開圖片若由 RapidAPI 取得，必須以可核對 permalink／媒體識別及圖像選擇關係匹配同一篇；無法匹配就顯示「圖片未驗證」，不得合併指標，邀請創作者自行上傳有權使用的圖片。輪播／影片舊貼文可做文字或有限指標回顧，首批圖片診斷只對已確定的單張圖片啟用。
3. 創作者明確選擇「分析這張圖」，看到圖片處理商與用途說明。分析回覆分開呈現：可直接觀察的物件／場景、圖片可辨文字、構圖／可讀性、caption 與畫面是否一致、模型不確定之處；不能從圖片猜身份、位置或商品功效。所有成長推論以建議／待測試表述，不當作平台已證實規則。
4. 創作者可按四張卡或自由提問；結果只引用當前 thread 已選來源與可用指標，顯示實際平台、問題、期間、擷取時間、引用、缺值與 HK／繁中覆蓋狀態。
5. 創作者**自己上傳**新圖片，選文案與 hashtag 建議後手動修改。上傳與建議皆私人；沒有圖片生成。發佈前核對圖片格式、權利、caption、合作披露、平台規格及目標帳號，顯示最終預覽。
6. 創作者逐篇明確按「發佈到 @帳號」。後端依最新授權、帳號 subject、草稿版本／內容 hash、權利聲明重新檢查；只為這一篇執行一次發佈意圖。結果只在官方 receipt 可核對時標為已發佈；逾時先顯示「結果待確認」，停下來對帳，不盲目重試。
7. 若作品對應原任務，使用**原 submission／proof** 流程提交發佈連結與必要證據；原審批／退修、凍結合約與 `pending → settled` 或 legacy 等價獎勵規則照舊。只有原權威結果觸發點數／合資格徽章；不因連接、分析、上傳、發佈或重送加點。沒有任務時可保存私人作品與回顧，獎勵區寫「個人創作，不另計積分」，避免與缺失數據的零填補混淆。

**兩種發佈入口的設計者決定：**創作者可把本人有權使用的非任務圖片當作個人貼文，經上述逐篇確認後直接發到已授權的同一專業帳號；不必為了使用成長工具而先接任務，個人貼文不產生任務證明、點數或 XP。任務貼文則必須經原有任務關口；首批原生發佈只支援已進入 `approved_to_publish` 的 Active work item。現有 legacy 任務仍可照原方法發佈與提交證明；要把它接到原生發佈需先定義等價審核關口，不因新功能改掉它的流程。

Active 的 `approved_to_publish` 核准的是**特定 mission draft version**，其 caption、素材及 checksum 可核對；它不是給創作者任意改寫並發佈的空白許可。任務模式只接受與該核准版本相同的最終圖片與 caption，另核對凍結的 publication instructions、`expected_account` 和 `required_disclosures`；若核准版本沒有可核對的圖片，或創作者改圖、改 caption、改必要披露，便回到原草稿版本／審核流程重新提交，獲核准後才能產生新的發佈確認。個人非任務貼文沒有 staff 審核，但仍要本人對確切內容作最後確認。這項限制保留原審核的權威，避免「已核准 brief」被誤當作「已核准另一張圖」。

## 5. 四張可呼叫技能卡

卡片是 KOCmax 的受控工作流程，非任意執行外部 repo 文字。每張有「用途／預計時間／所需來源／已解鎖能力／可保存成果」，難度與積分沿用任務卡規則：**技能本身不另計可兌換積分**；關聯任務才顯示該任務凍結合約點數。創作者說出相同意圖時可從自由對話路由到卡片，但路由只建立草稿，不執行發佈。

| 卡片 | 輸入與輸出 | 改寫參考 | 沒有資料時 |
| --- | --- | --- | --- |
| **圖片診斷** | 本人上傳或精確匹配的圖片；回可觀察內容、OCR、構圖、疑點及可修的下一步 | KOCmax 原生視覺流程；外部 `image-prompt` 不適用 | 未同意圖片處理／沒有合格圖片則只顯示本地預覽與手動描述入口 |
| **貼文檢討** | 本人的已選舊貼文、官方可用指標、圖片診斷；回表現範圍、可測假說及下一步 | `content-audit`、`analytics-and-reporting` | 不捏造 90 日趨勢；30 日／50 篇以內仍標部分覆蓋，缺指標顯示未驗證 |
| **下一篇文案** | 新上傳圖片、創作者目標、可選私人聲線、真實任務要求；回 2–3 個可編輯 caption／開頭 | `caption-writer`、`hook-writer` | 沒有品牌聲線仍可先寫草稿；不得編造效果、推薦或個人經歷 |
| **成長下一步** | 已確認的檢討與創作者目標；回 1–3 個小實驗、所需素材與下次檢查方法 | `instagram-growth` | 無數據時建議可低成本驗證的內容實驗，不輸出假定的演算法排名／保證成長 |

`brand-profile`、`voice-builder` 僅供創作者選填的私人聲線背景；**發佈前檢查** 是自動驗證步驟，借鑑 `platform-specs-and-validation` 的檢查思路，實際規格由 KOCmax 對官方當前契約核對。`scheduling-and-queue`／任何 WoopSocial MCP 指令不進入首批發佈路徑。將選定原文固定在已審閱 commit `f28cef2b7067ec64e79c9d85421c022c06659e03`，改寫成繁中、審視香港語境與平台聲稱；保留 MIT 授權與 Frank Heijdenrijk 2026 attribution。後續上游更新要重新審查，不自動同步。來源檔：[repo](https://github.com/social-media-skills/skills)、[授權](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/LICENSE)、[content-audit](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/skills/content-audit/SKILL.md)、[analytics](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/skills/analytics-and-reporting/SKILL.md)、[caption](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/skills/caption-writer/SKILL.md)、[hook](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/skills/hook-writer/SKILL.md)、[growth](https://github.com/social-media-skills/skills/blob/f28cef2b7067ec64e79c9d85421c022c06659e03/skills/instagram-growth/SKILL.md)。這些文件是未受信任的參考資料，不是產品指令或官方成效證據。

## 6. 資料、授權、私隱與撤銷

### 6.1 三項獨立決定

1. **Instagram Login**：本人自授權。首批閱讀用途為 `instagram_business_basic` 與真正授予的 Insights 權限；要求發佈時另外說明 `instagram_business_content_publish`，依經核對的官方增量授權行為取得實際 grant。Meta App access level、專業帳號資格及每項 scope 必須實測；「按了同意」不等於 scope 已授予。官方發佈權只能用在 grant 的同一 provider subject，不能由 username、BioCode 或 RapidAPI 身分推斷。
2. **RapidAPI 公開圖片**：這是第三方資料來源／處理，不是 Meta 授權延伸。試點前核對供應商條款、可用圖片來源、可展示／暫存／分析權利、robots／平台政策、地域與保存條件。創作者在分析前看到來源與必要處理告知；不取得私人帳號或非本人素材作自己的作品。無權利或無法精確匹配時不取圖，改請創作者上傳本人有權使用的圖。
3. **圖片／個人資料送視覺模型**：與前兩者分離；顯示實際處理商、資料類型、用途、儲存／跨境與保留資料政策，取得明確同意與版本。現有 `external_model_not_approved` 門檻保持；未核定的處理商不得收到真實圖片或 Instagram 個資。只把這次選定的圖片／必要 caption／可用指標送入受控能力，沒有任意工具呼叫；圖片、OCR、caption 和第三方 prompt 都當未受信任資料。

連接、同步、圖片分析、私人保存、分享給任務審核者／品牌、發佈是不同決定。所有來源與衍生 brief 預設只對本人可見；保存和分享前重查來源可用性及可轉交範圍，逐段列接收者、引用及文字。品牌只看到創作者已逐項批准的成果投影，不看到私人圖片草稿、聊天、未選舊貼文或完整原始資料。需要公開貼文時，以預覽說明發佈後的公開性，與「分享私人 brief」分開。

只保留與用途相稱的資料。建議首批目標：上傳原圖／RapidAPI 暫存圖片最多 24 小時，若創作者保存發佈草稿則私人原圖保留至完成／取消後最長 30 日；未被引用的指標快照 30 日；最小無 token 事件 90 日。正式期限應受現有資料政策與處理商實際能力覆核，且不得宣稱已驗證備份即時刪除。圖片 bytes、OAuth token、暫時公開媒體 URL 不進聊天、分析事件、普通日誌或匯出。使用者可在連接頁查看 scopes、最後同步、處理狀態，停止使用與刪除匯入衍生資料；已公開的 Instagram 貼文不能被產品刪除流程暗示會一起撤回。

撤銷順序沿用現有服務：先本地停用、增加 generation、阻止新分析／發佈與晚到回寫，再嘗試官方平台撤權；UI 分開顯示「KOCmax 已停止使用」與「Instagram 授權撤銷完成／待處理／需自行處理」。IG-01 的候選 endpoint、IG-02 app/subject/通知映射、IG-03 authorize host、IG-04 資格與 IG-05 真實 smoke 均未過關前，不以本地成功聲稱 Meta 端已撤權，也不使用猜測 subject 撤掉另一個 grant。舊發佈 approval 在撤銷或換帳號後失效；重新連接不能自動重用。

### 6.2 可見資料狀態與來源證據

每張分析／報告列：實際提問、平台、官方帳號或貼文識別（安全投影）、來源類別、精確圖片匹配狀態、觀察時間／期間、抓取時間、引用、可用與不可用的指標、實際覆蓋。第三方圖片與官方數值並排但標籤分開；第三方 likes/comments 不混為官方 Insights。香港／繁中受眾、地區或語言未能由資料支持時標「未驗證」，不能套用英文或美國數據；官方空集為「缺資料／不支援」，真正返回的 0 才顯示零。創作者手動補充的資料標「本人提供，未由平台核實」。

## 7. 發佈契約與安全狀態

第一批只做**立即發佈單張圖片**。官方 Meta 資料顯示 Instagram Login 有 `instagram_business_content_publish` 權限；但現有 repo 的 adapter 及官方可訪資料尚未證實本試點 App 的確切 publish host、container 流程、圖片規格、額度、回傳、撤權行為。實作前按**Instagram Login** 產品路徑核對，不把 Facebook Login 的 `graph.facebook.com`／Page token 示例套入。若當前官方契約要求 Meta 以公開 URL 擷取圖片，必須提供限時、不可列舉但持 URL 者可讀的暫存媒體端點；向創作者清楚說明這不是純私有傳輸。確認 Meta 抓取完成／結果對帳後關閉，逾期清理，禁止長久公開原圖。[Meta 官方 Instagram API workspace](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login)、[Meta 發佈文件入口（需在試點前直接核對）](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)。

**合作披露關口的設計者決定：**對有報酬、贈品或品牌合作的貼文，結構化記錄是否須 caption 披露、Instagram paid partnership label／brand tag 及其他任務條件，不能從自由文字猜是否完成。Active 任務以已核准的 `required_disclosures` 為基礎，但在原生發佈前需由有權設定任務者核實並轉為具體檢查項；未核實的合作要求不開放原生發佈。若當時的 Instagram Login API 無法可靠套用任務／平台必需的 label 或 tag，KOCmax 顯示原因並導回既有手動發佈與 proof 流程，不能只放 caption 就聲稱完全合規。非任務貼文由創作者如實聲明是否合作；若有合作而要求仍未釐清，同樣暫停原生發佈。正式試點前由產品／品牌政策負責人核對當時 Meta 規則與任務條款；本設計不預斷法律要求或 API 支援程度。

草稿與發佈狀態：`private_draft → asset_validated → preview_ready → creator_approved → container_preparing → provider_processing → publish_requested → published | failed | outcome_unknown`；取消／失效為獨立終態。單張圖片檢查格式、大小、畫面方向、權利聲明、caption 長度／限制、必要商業合作披露與當前帳號；規格數值由官方版本化 capability manifest 管理，文件未核對前不寫死可能過時的數值。創作者改圖片位元組／caption／目標帳號／披露／貼文類型後，舊確認立即失效，必須重新看最終預覽。模型與外部來源不能呼叫 publish；伺服器只接受本人當次的精確確認 receipt，驗證 session、workspace、owner、grant generation、scope、內容 hash 和過期時間。

每個 `publish_intent_id` 對一份固定版本草稿只有一次有效提交；資料庫唯一鍵與 worker lock 避免雙發。Meta 回應超時或網絡中斷不能當失敗直接重試；先查官方 container／media 狀態與帳號中相應 receipt，確認未發佈才由本人手動重新確認。`published` 要保存官方 media ID、permalink（若 API 有）、published_at 和 sanitized receipt；沒有可核對 ID 時顯示 `outcome_unknown`。發佈不等於任務審批或積分結算。公開貼文刪除／編輯不在首批 KOCmax 寫入範圍。

## 8. 概念資料模型與權限

重用既有 `integration_connections`／credential vault／generation、`studio_threads`／sources／briefs／shares、任務 submission／proof、reward contracts／pending rewards／points ledger；新增欄位或表須先另行審閱 migration、RLS、備份與回退。此處只定義契約，**不是 SQL 變更**。

| 概念實體 | 必要欄位或關係 | 安全／唯一性 |
| --- | --- | --- |
| IG grant 能力快照 | connection ID、workspace、creator、provider subject、實際 scopes、app/product/version、generation、expiry | token 僅加密後端；同 owner 一個啟用 subject；換帳號不沿用舊 consent |
| 媒體來源快照 | 官方 media ID/permalink/period/metrics；RapidAPI provider/ref/image match confidence、抓取時間、rights 狀態 | 兩來源分開保存；無精確匹配不可匯合成一筆「已驗證圖片」 |
| 視覺分析工作與結果 | owner、source/asset hash、處理同意版本、processor/version、observations/OCR/uncertainty、完成時間 | 私人、可撤銷；同意版本與 asset hash 變動即失效 |
| 技能呼叫 | card ID、curated prompt version、thread/context basis、sources、輸出版本、limitations | 只讀受控來源；來源版本與引用可追溯；無獎勵事件 |
| 私人上傳素材 | owner/workspace、object key、SHA-256、MIME/size/scan、rights declaration、expiry | 私人 bucket、短效受控讀取；跨 owner/service path 重新授權 |
| 發佈草稿／批准／嘗試 | account subject、asset hash、caption/disclosure hash、revision、approval actor/expiry、intent ID、provider container/receipt、state | 每次確認綁定精確版本；唯一 intent、防重送、未知結果人工對帳 |
| 任務關聯與獎勵 | 原 mission submission/proof ID、publish receipt ref、凍結 reward contract、原 ledger/badge event | 不新增「發文積分」帳本；原結算唯一鍵及資格檢查仍為權威 |

所有本人資料以 KOCmax session 的 `workspace_id + creator_id` 決定 owner，不信任前端／模型提供 owner；每次讀取、分析、分享與發佈重新查服務端權限與 RLS。品牌、operator、reviewer 的既有能力隔離保持；只透過既有經批准分享與審稿投影進入原流程。將新私人資料納入現有匯出、匿名化、刪除、失效清單和備份後重刪程序。對話是協調層，不是發佈或點數的唯一真相。

## 9. 優先修正與驗收階段

本節描述**日後實作順序與通過條件**，不表示本設計獲批准後可立即做真實 provider 動作。保留最近修正，任何試點都需顯示目前分支 SHA、mock/live 開關、資料庫 migration 清單和可回退資料範圍。

| 階段 | 工作 | 退出條件 |
| --- | --- | --- |
| A：介面及 session 修正 | operator 直達任務編輯頁只見可用能力；brand member 不見無權刪除；登出即清畫面／快取並導向登入；非職員拒絕文案不假稱 Google 登入 | 手機與桌面逐角色核對 UI，API 權限仍拒絕越權；登出／返回／重載都不露舊私人畫面。品牌刪除服務端規則先以現行 capability 查明，按它渲染 |
| B：refresh token 重播 | 新建專用可清理帳號／session；記下最小無密碼指紋；依真實產品 logout/ban/revoke 行為做舊 refresh 重播與舊 access JWT 行為測試 | 明確記錄舊 refresh 被拒絕或平台實際行為，不用 timeout 當 PASS；每個 session／token 的精確清理、封鎖及唯讀後置讀回；原 D1 的 `CLEANUP_BARRIER_TIMEOUT` 保留為歷史限制 |
| C：離線混合來源、圖片與技能 | mock 官方／RapidAPI／視覺模型／發佈；四張卡、來源標籤、上傳、預覽、未知結果與撤銷狀態 | 320／390／430／1440px、鍵盤、減少動態與弱網可用；無連接基本任務可做；來源不匹配、無圖、無處理同意、假零、prompt injection 全部正確擋下 |
| D：Meta 協定及供應商權利關口 | 核對 IG-01–04、Instagram Login publish host/token/permission/container/公開媒體需求；檢查 RapidAPI 可用圖片與用途條款；選定並審批視覺 processor 條件 | 每項有官方／供應商版本、實際測試帳號與回執；有一項阻斷則對應 live 功能保持關閉；不由代碼 mock 自行轉 PASS |
| E：獲另行批准的隔離真實試點 | 至少兩個經本人同意的專業 IG 測試帳號（一個目標、一個錯帳號隔離），配新 disposable KOCmax 帳號；先測一篇**非任務、非合作**的測試用單圖，官方讀取／撤權／通知與對帳 | 發佈前有逐篇確認；只能發到當前授權 subject；未知結果不重發；撤權後停用；同工作區／跨工作區／品牌／職員無權讀寫；確切測試資源及私人資料清理，提供回執 |
| F：原任務接合與回歸 | 在有資格且接受條款的測試帳號，先驗 Active 核准版圖片／caption 完全匹配，再測編輯後回審、任務披露與不能自動設 label 的手動退路；走原提交、審稿、退修、proof、pending/settled、徽章；保留 legacy/Active 分支 | 任務只有原合約點數及 XP，沒有重複入帳；未核准的變更不發；手動退路仍可交原 proof；手機／桌面四類旅程保留現有功能與 recent fixes；通過後另議部署 |

真實試點需先決定：Meta App 與測試專業帳號、實際 access level/審查、視覺處理商與資料條款、RapidAPI 圖片使用條款、暫時公開媒體的披露、託管／資料庫隔離方案、備份與清理責任人。若仍使用既有共用 DB，須重新審閱精確 SQL、恢復點、非試點指紋與清理邊界；D1 的已清理帳號不能拿來重測。**在獨立批准前，live flags 預設關閉，不能連 Instagram 或部署；Google Drive 繼續關閉。**

## 10. 必測反例與驗收證據

- 身分：username 改名、同名、RapidAPI 指向另一貼文、carousel 第一張誤配、OAuth callback 換 session／workspace／帳號、授權部分 scopes、過期／重播 state、晚到通知、撤銷後重連。全部不可寫錯帳號或讀別人的原圖／指標。
- 圖片：格式與大小不符、惡意檔、OCR 指令／假系統訊息、圖片中私人資訊、模型誤認品牌／商品、RapidAPI 失敗、不同圖卻相同文字。回覆標不確定、保留手動修改，不從圖片內容下命令。
- 分析：官方缺指標、真正 0、僅部分期間、少量媒體、HK／繁中未知、舊快照、私人來源撤銷。報告列出真實問題／平台／期間／來源及限制，不編造 90 日歷史或演算法保證。
- 發佈：換圖／改 caption／換帳號後舊批准不能用；重按、雙分頁、逾時、Meta container 處理中／錯誤、短效公開 URL 過期、revoke 與發佈競態。只有可核對官方 receipt 才顯示成功；未知狀態先對帳，無盲目重試。
- 權限：本人／同 workspace 另一創作者／跨 workspace 創作者、brand member、operator、reviewer、finance viewer 的 API、RLS 與畫面。即使 UI 藏按鈕，也要有伺服器拒絕；職員不可見未分享私人草稿。
- 原功能：訪客、創作者、品牌、營運全導覽；任務接單／條款、brief／proof、審批／退修、points／XP／徽章／兌換、原有下載／匿名化與錯誤恢復。發佈與卡片不改舊業務契約。

每層分開報告：本機單元／mock、真實 DB/Auth、Meta 測試帳號、手機／桌面瀏覽器、託管試點、正式環境。模擬、provider 文件、CI 或局部截圖均不能代替真實 Meta／Auth／RLS 或正式發佈驗收。每次測試列環境、帳號別名、版本、時間、測試問題、來源、結果與清理回執；不要在報告保存 token 或私人圖片。

## 11. 留給建造者的決定與下一個批准點

建造者可在上述產品契約內選擇 schema 命名、內部工作佇列、受控視覺 adapter 介面、圖片檔案具體限制與 UI 元件切分；所有限制都須根據當時官方規格與實際處理商能力版本化。對外處理商、Meta 應用／帳號、真實授權、共用 DB SQL、發佈測試圖及公開暫存媒體、部署，則須在試點前交付具體審閱包並取得**新的明確批准**。這份設計獲批准後，下一步是寫實作計畫；不是啟用連接或發佈。

2026-11-04 獨立建造者檢查提出三個影響計畫的問題；本設計已明定個人非任務貼文可發佈且無獎勵、Active 任務必須使用已核准的確切 caption／素材、合作標籤無法可靠套用時走原有手動發佈與證明流程。這三項是本設計的明示選擇，仍待產品負責人審閱。
