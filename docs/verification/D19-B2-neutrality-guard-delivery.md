B2-P0 本機補驗已完成，B2 runtime 尚未批准或執行。

先測試確認 browser runner 原先會在 UI subprocess exit0、budget 改動時仍 exit0；本輪在既有 snapshot／runner／fixture 補上相等驗收，缺失、跨 target／workflow 或不一致證據必須 fail。完整模式比較九個財務表的 scoped opaque row hashes、workspace 全部 Creator XP、庫存及 legacy issued anchors；join +10 與既有 legacy 發放仍分開驗收。沒有新增業務引擎或 schema。

| 層次 | 本輪結果 |
| --- | --- |
| Code | 8 source files及1 plan狀態修正；source `d13fe2b7e8b9838972b8d93881dc17e8ccfc2795bc133b01cdc4f1a35426f893`，779 records；HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，未 commit |
| Test | full 2,047 pass／0 fail／363 gated skip／288 files；原16／194與20新增本機測試；type、lint、build、manifest exit0；E2E只做syntax check |
| Deployment | 未部署；沒有 commit／push／merge／deploy |
| Runtime | 沒有建立 target、fixture，沒有真實 SQL／Auth／API／角色／browser E2E；provider disabled；當前 R1 未 verified |

測試先後、失敗嘗試及修正見 `D19-B2-neutrality-guard-test-history.json`。最終 commands／時間／source before-after／實際 logs 見 `D19-B2-neutrality-guard-gates.json`；full 逐檔 assertion結果見 `D19-B2-neutrality-guard-full-results.json`。363 skips不算通過；full log中的mock target labels及故意失敗訊息不是真實環境操作。Lint保留4個既有warning；build既有route／bundle訊息見raw log。

72 migration及42項protected manifest未改；digest `3e6809f9a51b1ac7ebb9f770160aab27f02523ebf69fc47f8fe38f44d05f6363`。新完整快照SQL只作唯讀查詢建構／mock驗證，尚未在真實Postgres執行。Schema diff見 `D19-B2-neutrality-guard-schema-diff.json`。107 cases／28 findings的原始欄位保留；只更新4個相關case的newResult並明示runtime未跑。

最新 runtime manifest為 `D19-B2-runtime-manifest-neutrality-guard.json`，SHA-256 `96d3afa5e6b982f9ed537d2c95d45fd9dc3b7dc230f96d9649ef5d6bfffcc417`。它取代舊未批准spec作後續review；舊manifest及全部原P0證據原樣保存。新authorization template仍`approved:false`。本輪準備不構成runtime批准；資源／fixture caps及role8→core9→browser5範圍沿用既有review，實際IDs、cache、ports、mounts、catalog仍待批准後核實，client／setup前必須通過identity gate。

當前模型介面核實 UNKNOWN：read-thread未提供選定模型；唯讀Computer Use app approval timeout，沒有取得model state，也沒有切換模型。Root歷史executionModel不重綁本輪。Node24.18.0 gates通過；Node22離線probe回報ENOTCACHED，未下載安裝，現存executable可用性UNKNOWN，本輪未重驗Node22。

原3筆campaign事故 OPEN／unrestored，舊shaped target僅鑑證且排除驗收；本輪無讀取或生命週期動作。不還原、不刪除、不新建資料、不停止容器、不關閉事故、不解除release HOLD。原pristine兩個全域RPC結果原樣保留且沒有重跑。

剩餘條件逐項見 `D19-B2-neutrality-guard-r1-checklist.json`及`D19-B2-neutrality-guard-completion-audit.json`：新target identity／forward bootstrap／schema history、真實8 role與9 core、5 browser完整legacy／active／修稿／proof／完成／刷新pending與歷史、pending／cancel／reapproval原始財務相等，以及107案例適用性整合。D15四堂核准教材仍缺；具名advisor owner／實體裝置manual AT與hosted驗收、正式staff銜接仍blocked。正式membership0是scope問題，既有檢查保留。發布／pilot enablement／七日觀察未獲批准或執行。

Rollback見 `D19-B2-neutrality-guard-rollback.json`：本輪modified檔案有exact before copies及before／after hash；只可在明確要求後比對並還原指定本機差異，保留其他dirty work與事故證據；不執行資料rollback。

下一步：review並明確批准上述新版source-bound runtime manifest後，才執行新target身份核實與bootstrap，依次role／core／browser。現時停止在已驗證的本機交付checkpoint。
