# D19 C2：停止紀錄及 transport 修復

原 C2 **已獲明確批准並已嘗試**，原批准收據仍為 true。首次在 sandbox 的 Docker pipe 身份查證失敗；同 source 的 host 續跑通過完整身份查證，但在第一個 provenance catalog SELECT 因 `ENOBUFS` 停止，未到 claim、migration、SDK、Auth 或 fixture。兩次 terminal exit1 及 private log hash 均保留，不把它們當通過驗收。

唯讀查證當時：72 migrations、84 Auth subjects、6 workspaces、6 missions；新 RPC、history、workspace、claim、owned journal 均不存在。原70類 row hashes、八節 catalog、immutable seeds/service history 保持相同。19次完成的唯讀 SQL 加1次輸出失敗的唯讀 catalog SELECT，不涉及資料寫入。兩個完整9類財務 readback 相同，這只是唯讀查證期間保留證據，**不是 application／pending reward E2E neutrality**。

真正 catalog 為1,106,880 bytes，超過 Node 預設1,048,576 bytes。只在既有 Docker owner transport 加有限8 MiB capture；SQL、身份／權限檢查、expiry、business／UI及73個 migrations 不變。新增 native4項，執行實際 private helper 與真正本機子程序：完整2 MiB JSON、multibyte完整性、9 MiB超額拒絕、child exit7拒絕；不呼叫 Docker／DB。

| 本輪驗證 | 結果 |
| --- | --- |
| TDD 原 helper | 2 expected fail／2 pass；ENOBUFS重現 |
| 修復後4項 | 4 pass |
| focused transport／C2／manifest | 33 pass |
| 原完整 sandbox run | 2120 pass／13 fail／363 skip；完整保留 |
| host boundary 4 files | 32 pass |
| 最後 Node22 native full | 2133 pass／0 fail／363 skip，293 files |
| 原 audit16／protected194／C2 supplement26 | 全數通過；不降低原語義 |
| build／lint／schema manifest | exit0；既有 warning 見 logs |

首跑13項逐項對照 final host PASS：9項為 test-owned loopback 權限／其依賴 assertion，2項為 temp atomic rename EPERM，2項為 cached Node22 runner 缺 installed npm_execpath。只修 runner設定及在 host 執行本機測試，沒有改 assertions。原失敗不是 auto-review rejection。363項 skipped integration不當 PASS。先前 standalone assistant8及memory SQL7維持各自 source binding，不加入 native總數，今輪未重跑。

Source `ead55a808470f90d72290905db90933cb4a6df48eaba519d4587339a4659b71d`（789檔）；保留 HEAD `7cfa3dc84c821719a4dff754229a591c81786c53` 及原 dirty work。新 source **未獲 runtime批准／未啟動 writer**；application API、3項 Edge情境、forward73、6個新Auth／1workspace／4missions均未執行。原696e／pristine已通過範圍沒有重跑。

下一步只審批 `../D19-C2-transport-continuation-runtime-manifest.json`，digest `f5caccfdc354e7209b320064f08c9a59ce73cc0ae4bdfca4bcde6e255b424ba0`。沿用原5個C1資源、fixture IDs及caps；新增資源0。需批准的額外本機處理僅是精確封存3個未消耗 receipt/result檔案，現在尚未移動。批准後仍先完整核實身份及唯讀 provenance，任何不一致即停，不自動重播。

`remaining-acceptance.json` 列出 application、binary asset、完整 cross-Creator、legacy同意圖 replay、nonempty migration、GATE14及未跑角色／browser facets。D15教材、具名 advisor owner／裝置／hosted／manual AT、正式staff限制保留；107個 original欄位及UC-C18／A51原期望不變。事故OPEN／未還原、舊shaped鑑證專用、release HOLD、provider disabled。**未部署，無commit／push／merge，非R1 verified。**

精確命令、Node22版本、fresh RAM、terminal receipts及逐項失敗處置見 `gates.json`／`failure-reconciliation.json`。Schema見 `schema-diff.json`，選擇性本機rollback見 `rollback.json`；不執行資料、schema、角色或container還原／清理。
