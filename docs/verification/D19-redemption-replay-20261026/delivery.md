# D19 本機兌換重試修復與交付覆核

UC-C33 已補上同一意圖的持久化 receipt；未知回應、關閉重開、刷新可取回同一作者的兌換結果。原 redeem_gift 與73個 SQL 檔沒有改動。Forward74 只在記憶體 PostgreSQL 執行，尚未套用實際 target。

最終 source：`4f2c3faa22bf835911a55dc7bb099910e4308fc1b7a5570d58f32386708934b9`，793 records。Native full **2155 pass /0 fail /363 skip，295 files**。當中含新增 SQL10／UI11、原 audit16／protected194；release foundation108、type/build/lint/schema/manifest review 通過。另跑 wallet/notifications impact8，不加到 full count。Lint 保留4項既有 warnings。所有 RED、完整首跑及中間失敗日誌保留在 failure-disposition.json。

SQL 驗證涵蓋一次扣分／發碼／扣庫存、同意圖重播、庫存用盡後取回、不同作者隔離、晚期失敗原子 rollback、ACL/RLS；UI 涵蓋重試、刷新、取消重開、儲存失敗、帳號／workspace 切換及既有 history 取回。這是 memory SQL／jsdom／scripted HTTP 證據，並非實際 Auth／PostgREST／獨立連線競爭或 browser E2E。沒有實際兌換、付款或 pending reward 發放。

最終 C2 review：`../D19-C2-current-source-runtime-manifest.json`。沿用同一 C1 五個資源、原 namespace/IDs/caps，零 Docker 資源／lifecycle 操作；只 forward73、6合成 Auth／1 workspace／4 missions、既有 API＋3 Edge 情境及9類財務 row 比對。Forward74／C33 實際兌換與 E2E 明確排除。新 source/digest 未獲 runtime 批准；原 e8 批准仍為 true，舊 f5 及 provisional98 proposal 保留並標為 superseded。未執行三份 local archive 或任何 target 查詢／寫入。

R1 尚未 verified。完整剩餘角色／browser／財務／migration 驗收、依賴及完成條件見 remaining-acceptance.json；保留 D15、具名 advisor owner／裝置／hosted、正式 staff blocker。原三 campaign 事故 OPEN、未還原，舊 shaped 只作鑑證；release HOLD、真實 provider disabled。沒有 commit/push/merge/deploy。

交付索引：delivery.json、gates.json（精確 commands／counts／logs）、schema-manifest-final.json、schema-diff-final.json、case-coverage.json、readback-summary.json、changed-source.json、changes.patch、rollback.json。原107個 audit 欄位與 D15 原記錄保留。Rollback 僅提出有 before/after hash 的選擇性本機還原，沒有執行資料補償、刪除或 down migration。

完整驗收依賴、完成條件及尚未跑的角色／browser E2E：acceptance-checklist.json。
