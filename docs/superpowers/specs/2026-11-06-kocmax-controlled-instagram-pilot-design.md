# KOCmax：Instagram 品牌任務受控試點（整期設計）

日期：2026-11-06。狀態：用戶已批准整期設計；實作計畫待審閱。不是部署或真實操作批准。
現有分支：codex/kocmax-studio-stages-1-2；不 stage／commit。

## 目標與成功定義

用戶選擇 A「受控完整試點」：準備好讓少量創作者，在另行批准後，從品牌任務完成一次 Instagram 真實發佈、證明核實及原有結算。整期一起設計、規劃與驗收，不以零碎 mock 成功代替最終結果。

設計者建議：3–5 位受邀創作者、一個品牌、每人一項單張圖片交付；先一位完成並核對，再擴至其餘成員。名單、窗口、獎勵額及實際責任人於啟動批准包確定。以上數量是提案而非既有用戶要求。

兩個里程碑：
- **可申請啟動**：本地整合、權限／故障／恢復驗證及具體批准包完成；未取得實際 App 權限或撤銷證據的項目仍列 BLOCKED，不宣稱可真實發佈。
- **真實試點完成**（另行批准後）：每個參與者的任務均有可追溯結果；至少第一位走通「官方發佈→真實證明→核實→原結算」，其餘成功、退出或阻斷皆有記錄。不得以手動發佈結果冒充直接發佈驗收。

反目標：代創作者自動發文、發佈即派分、私人來源外洩、重試造成重複貼文、為通過試點移除合作標籤要求、把未知資料填零。

## 現況及保留項目

已存在 React／TypeScript 任務頁、版本審核、PublicationInstructions、ProofSubmissionForm、reward handoff、私人成果卡及 Native mock 發佈流程。最新任務入口驗證報告是 `docs/review/kocmax-stage-5/mission-publish-entry-mock.md`；232/232 是選定 mock 回歸紀錄，不是本設計已完成或真實 API 通過。

知識圖已確認 activeMission 的創作、證明及結算是獨立既有模組。實作時以當前程式為準重新盤點，避免重做已有 native adapter／轉圖／handoff。新增工作應集中在缺少的持久化、正式連接協定、角色交接與故障恢復。

| 現有功能 | 本期保留與延伸 |
|---|---|
| 訪客首頁／品牌介紹／任務發現 | 維持既有導覽；邀請不是所有基本任務的門檻 |
| 對話／Brief／圖片上傳 | 對話引導下一步，任務頁仍是權威；私人內容不自動成為品牌附件 |
| 草稿／退修／版本核准 | 核准指定版本與披露；任何圖文變更重新審核 |
| 任務發佈指示／手動證明 | 保留；直接發佈不可用時說明原因，手動是備援、另列結果 |
| 審核／營運／結算／錢包 | 沿用權限與帳本，不增加並行派分機制 |
| 已保存成果／複製新草稿 | 私人預設、保留來源；複製不繼承核准、發佈確認或獎勵 |
| 其他任務／獎賞／學院／品牌與營運頁 | 回歸驗證，不因試點重寫或移除 |

## 方案與選擇

A 受控完整試點（用戶已選）：小名單、單一品牌、單圖、人工審核及營運伴隨，驗證完整直接發佈鏈。
B 手動發佈先行：投入較少，但無法證明直接發佈，僅保留備援。
C 完整自助平台：支援面較廣，加入多格式、排程與公開招募會放大風險及延後首個真實結果，本期不採。

Native 指自建官方 API adapter，不用第三方代發平台。沿用現有 stack；Google Drive、RapidAPI、外部 vision processor、Reels／Stories／輪播、排程、廣告投放皆不在本期。創作者自行上傳圖片；成效分析非完成任務的前置條件。

## 官方能力：必須先解開的路線差異

2026-11-06 只讀核對 Meta 維護的 [Organic Content Creation](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/creators/organic-content-creation.md)：付費合作標籤限 Facebook Login；媒體需讓 Meta 抓取；JPEG 為圖片支援格式。這些是文件證據，不是試點 App 驗證。主開發文件本次工具讀取失敗；須在 protocol gate 重新核對實際版本及 App。

**設計者提案，需連同本設計批准：** 品牌付費合作任務以 Native Facebook Login adapter 作為待驗證試點候選路線，與現有 Instagram Login adapter 分開標識，不能混用 subject、host、scope 或 token。本階段不自動轉換已有帳號或索取新權限。若候選路線資格／標籤／撤銷協定不能驗證，直接發佈保持 BLOCKED，不能把合作任務偽裝為非合作以繞過限制。

協定驗收產物必須列出：Meta App ID／所有權、登入產品、鎖定 API 版本、redirect allowlist、專業帳號與 Page／品牌關係要求、實際 permission 清單與 access level、帳號 ID 映射、品牌標記資格、撤銷 endpoint、signed notice 驗簽與身份、資料刪除 callback、錯誤碼／限額。僅申請發佈與身份必要權限；不預先請求廣告、訊息、聯絡人或 Insights。需要額外權限時要說明其必要性並列入批准包。

## 完整使用旅程與畫面

1. **邀請與準備**：首頁顯示「這次一起完成一份品牌作品」卡；基本功能照常。試點準備頁顯示任務、官方帳號資格、來源同意及支援聯絡人。Username／bio 只證明另一種帳號控制，不顯示成發佈授權。
2. **創作與送審**：從對話／任務卡建立 Brief，自己上傳；轉 JPEG、去除不必要 metadata、檢查大小尺寸及比例，完整顯示最終圖文。轉換在品牌核准前完成。私人物料逐項確認分享，生成不可變版本。
3. **品牌審核**：品牌只看獲授權的任務版本及必要來源聲明，不看私聊。顯示版本差異、披露、帳號要求、截止時間。核准／退修沿用既有角色能力；不把所有品牌成員自動升級為 reviewer。
4. **創作者最終確認**：從任務頁打開核准版本，確認目標帳號、完整圖、文案、平台合作標籤、品牌對象及公開範圍。勾選預設關閉；批准是逐篇、一次性。品牌核准不是創作者授權。
5. **發佈與恢復**：送出後顯示「正在確認這次結果」。網路中斷、重新登入或跨裝置回來，讀取 server intent；不自動重送。結果未知只允許查詢及聯絡支援。
6. **證明與結算**：可驗證的 media ID／permalink 建立證明提案，由創作者核對後提交原流程；reviewer 核實，營運依原合同結算。狀態明確分為已發佈、已提交、已核實、待結算、已入帳。僅最後一步更新錢包；XP／徽章僅按既有可核實規則，沒有規則則不新增。
7. **收藏與下一步**：私人成果卡顯示核准版本、貼文連結、原任務與核實記錄；分享逐項確認，複製為新草稿不繼承舊權限或批准。成效來源不可用顯示未連接／未驗證；HK／繁中缺口如實保留。

手機單欄、大按鈕、清楚的下一步；桌面同一狀態語義、預覽與任務側欄。對話保持入口，既有導覽仍能直達所有功能。明亮紫／青／奶油色、卡片與進度徽章；不以積分倒數、連續登入懲罰或成功發佈獎勵動畫催促。

## 狀態、資料及恢復契約

任務原狀態機不被發佈狀態機取代。Publish intent：prepared → confirming → processing → published／outcome_unknown／definitively_failed；未送出可以 expired／cancelled。只有確認「未發佈」才可提供新一次確認，不把 timeout 當失敗。重新發佈任何新版本都需新核准與新確認。

伺服器記錄 owner＋workspace＋submission＋item＋approved version＋image hash＋caption hash＋instruction revision＋provider product＋account subject＋grant generation。preview fingerprint、nonce、session及到期時間一併綁定；確認時重新驗證所有資料。每個 account／item／approved version 的 active intent 具唯一性與交易式 reservation；worker claim、provider container ID、attempt 與事件持久化。跨 tab／裝置競爭仍只有一個 publish attempt。

Provider write 前後的 crash 要逐一故障注入：容器建立後可查回容器，publish 回應遺失時保持 unknown；沒有可靠 provider 證據不得猜測成功，也不得直接重播。Operator 只能查詢、停用、標記需人工核對；不能任意把 unknown 改為成功。重新登入要求同 owner，不能向其他帳號顯示私有 intent。

Receipt 綁定 intent、實際 account/media ID、permalink、時間與 provider response provenance；mock receipt 永遠不可進真實 proof。proof 重複提交沿用原唯一性／衝突處理，ledger 原權威仍是唯一派分途徑。

新資料採加法 migration，owner-consistent FK、最小 grants、RLS、重複索引審查及 rollback；不刪改舊表以完成試點。具體 SQL 另形成 review artifact，設計批准不等於 SQL 批准。

## 權限、私隱與停止

Creator 只能管理自己的連接、草稿及確認；同 workspace 同事也不能讀私人內容。Brand 只見任務授權內容；reviewer／operator／finance／admin 沿用現有最小職責，service-role 仍驗證 actor、workspace 與資源歸屬。模型沒有發佈批准能力。

Token 只在 server 加密保管，輪替／刷新避免競爭與重播；不進瀏覽器、聊天、log 或報告。OAuth state 一次性綁 session，callback 防跨帳號混淆。每次發佈前驗目前 grant generation。

私有原圖／brief 不公開。只有經確認的最終 JPEG 可建立不可列目錄的短期公開抓取 URL（屬對外資料提供，必列批准包）；隨機難猜 URL 不是私人存取保證。提案租期15分鐘、完成後撤銷、最長不超過1小時；協定實測若不適用則停下調整，不默默延長。Cache／CDN 刪除與 provider 已抓取副本的界線要說清楚。

本地停止立即拒絕新操作並增加 grant generation；與 provider 已撤銷分開顯示。Provider 撤銷未確認不可寫「已完全解除」。已被 Meta 接受的貼文不因本地 rollback 消失。緊急停用須在每個外部寫入前檢查；已在途要求只查證、不重送。

資料保留提案：token 在退出／撤銷後按協定清除；暫存媒體依租期清理；可識別故障診斷7日；純測試資料在試點結束7日內清理。真實任務、證明、獎勵與必要稽核沿用既有保留規則，不當成測試垃圾刪除；啟動前列出具體期限與政策責任人，未定則不放行。刪除公開 Instagram 貼文需創作者確認，不能用資料庫清理代替。

## 整期工作包與交付（批准後才寫實作計畫）

| 工作包 | 交付與通過條件 |
|---|---|
| 1 現況／官方協定 | 已有功能對照、候選登入路線、實際權限／標籤／撤銷驗證清單；未知能力明確阻斷 |
| 2 持久化與安全 | intent／worker／receipt 持久化、RLS、nonce／session、防重發、短期媒體租約；offline crash tests |
| 3 三方完整介面 | 邀請／準備、創作送審、版本審核、預覽發佈、unknown 恢復、證明、結算、收藏；手機與桌面同語義 |
| 4 全旅程驗證 | 真實 auth 前先 mock 全角色／故障矩陣，保留現有功能；SQL與還原方案可審閱 |
| 5 啟動批准包 | 精確環境、App、名單別名、權限、費用、SQL、restore證據、測試圖文、公開URL、窗口、責任人、清理ID與停用方案 |
| 6 批准後實際試點 | 先一位再擴大，逐層真實證據、例外處理、清理readback、結案報告 |

一次批准整期設計後，以上形成一份 Native implementation plan，不逐項要求選下一個小功能。外部副作用依具體啟動包另批。任何憑證或真實帳號操作均不在本次工作中。

## 測試帳戶、資料與驗收矩陣

準備別名 C1–C5、同 workspace 非owner C-peer、跨 workspace C-other；品牌 owner／member、reviewer、operator、finance、admin、visitor。權限測試可離線組合；真實 Auth 帳戶建立、live RLS 測試及清理須列批准包。Provider 以同意的專業帳號作正例，加一個不應受影響的帳號作負例。不得借用現有一般用戶或生產任務。

用合成圖片與假資料作離線測試；真實任務使用創作者有權公開的最終圖文。只保存別名於 Git；密碼、tokens、私人證據不入庫。每批測試有 run ID、owner、預期 rows、清理順序及前後差異。

必測：完整成功、退修重審、版本／圖片／帳號／指示變更、來源撤權、OAuth replay、refresh replay、跨owner、跨workspace、雙tab確認、重載／Back／Forward、401、429、timeout、worker crash、撤銷與kill switch競爭、缺披露、label不支援、媒體URL到期、receipt偽造、proof重送、結算重送、清理失敗。

手機320／390／430及桌面1024／1440，鍵盤焦點、44px操作、無橫向溢出、長繁中文案及錯誤訊息；舊訪客／品牌／營運／任務／收藏導航需回歸。報告列實際測試問題、角色、平台、時間、來源及環境；缺測不能標 PASS。

真實試點硬門檻：零錯帳號／未確認發佈、零重複貼文與重複積分、零私人資料／token外洩；每個成功貼文都綁定核准版本、真實回執及原核實記錄。出現重大隔離問題、未知發佈或清理失敗即暫停擴大。成長率與觸及不作技術試點成功保證。

## 環境與啟動批准包

本階段先在現有分支離線準備。未經批准不得部署、套SQL或實際連接。未來部署位置、HTTPS callback、worker排程、媒體host、密鑰保管及費用須是批准包具體資源，不臨時猜測。沿用用戶指定 Remix-Adfocate 資料庫的偏好，但只在獨立 schema／owner 隔離、已審 SQL、可還原點及精確 cleanup 成立後申請套用；若不能隔離，不以共享生產資料冒險。

啟動批准包分列可批准的副作用：部署／環境設定、SQL、建立測試帳戶、OAuth授權、暫時公開媒體、第一篇實際貼文、後續名單及結算、清理。可一次批准指定範圍，不代表無限期授權。Creator 仍需逐篇確認，品牌仍需逐版本核准。

## 設計者決定與尚待驗證

提案：3–5人／單品牌／單圖、逐人放量；付費合作走隔離的 Native Facebook Login 候選 adapter；先不接 Insights／vision／RapidAPI；租期與保留期限如上。這些不是已完成或既有用戶承諾，可在本次整體設計審閱修正。

Builder 可決定元件拆分、索引命名、測試fixture組織及顯示細節，須保留既有職責與原狀態機；不可自行降低安全／披露／核實門檻或改變外部操作批准界線。

## Builder check

2026-11-06：獨立 reviewer 已閱讀整份設計，回覆沒有阻礙規劃的重要未解問題。3–5人及 Facebook Login 是待用戶批准提案；實際 provider 能力、資源、責任人及保留期限仍按文件的啟動門檻驗證，不能視為 reviewer 已替真實環境背書。

已在內建瀏覽器檢查創作者／品牌／營運及手機概念切換。這是可互動的設計示意，不是產品功能實作或完整響應式驗收。概念來源：`.superpowers/brainstorm/2005-1793897880/content/controlled-pilot-whole-stage.html`；截圖：`docs/review/kocmax-stage-5/controlled-pilot-concept.png`。

實作計畫：`docs/superpowers/plans/2026-11-06-kocmax-controlled-instagram-pilot.md`。沿用 Native、同一分支及 no-commit／no-live 邊界。
