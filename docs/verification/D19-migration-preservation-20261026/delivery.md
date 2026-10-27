# D02／D19 migration preservation 覆核 — 2026-10-26

本輪完成唯讀本機證據覆核，沒有新的 application／SQL 修改、測試 suite 或 runtime 操作。

- 舊 C1 baseline72 的 raw hashes 全部與當前 source 相符；protected manifest43 及舊 shaped36 的 LF hashes 亦全部相符。Full baseline 和 protected forward manifest 範圍不同，不能互相替代。
- 舊 shaped replay 只直接比較一筆 legacy submission 的 status 和 content_urls[0]；沒有保存完整 before／after row snapshot，也沒有證明非空 proof／ledger cohort 保留。14筆 oldHistory 是事前讀回變數，不能冒作獨立 after-history 證據。
- 舊 C1 最終三個 phase、每個70 families 的 sealed inventory 合計有7筆 submissions、4個 workflows、6次 URL proof attempts／reviews、4筆 pending reward，以及 points／cash／budget ledger 各2筆。這是 e839 時的歷史直接檔案證據，不是本輪 live state 或 migration73 結果。Draft/proof assets 與 storage objects 均0，不能聲稱 binary bytes 已保留。
- 當前 C2 runner 已在 forward73 後、建立 SDK client 或新 fixture 前，比較原有70 families 的完整 inventory 及9類全域財務 ID／row hashes，並核對 catalog／history／ACL／immutable seeds。這是 source 直接證據，runtime 仍未批准或執行。

因此，原 remaining list 的「只唯讀／沒有 migration」描述已修正：不重播原72 migrations／9 compatibility statements，但待批 C2 明確包含一次 forward73 及非空資料保留比較。今輪沒有要求另一個 target，也沒有擴大 C2 批准範圍或重問已完成696e批准。

UC-R04 只更新新結果欄，明確保留 whole-current-case NOT_VERIFIED。107個原欄、D15 UC-C18／A51 及上一輪 UC-A11 整行均保留。現有48項相關 native assertions 從同 source 的 full report 核對；未重跑，也不新增到2129 full 或獨立 memory7計數。

重現本機證據檢查：

```powershell
python docs/verification/D19-migration-preservation-20261026/verify-preservation.py
```

scope-red.json／scope-green.json 記錄的是文件驗收範圍檢查前後，不是產品 RED／GREEN 或 DB 測試。最初一次臨時唯讀 helper 使用 Windows CP950 預設解碼，在讀檔階段失敗；修正為明確 UTF-8，沒有資料操作，未列作產品失敗。

下一步仍是現有 exact C2 manifest 待明確批准；獲批後，必須先做 fresh identity／provenance，任何 drift 都停止依賴動作，不猜值還原。只有實際73 before／after成功證據才能支持該 migration window。其他 R1 asset、cross-Creator、legacy API／併發／score／UI、GATE14 等缺口，以及 D15、具名 advisor／裝置／hosted、正式 staff、audit ZIP blocker 保留。

Rollback 只涵蓋本機 exact-before 文件。未做 DB down／reset、舊 binary redeployment 或資料還原；事故 OPEN／未還原，舊 shaped 鑑證用途不變。release HOLD，provider disabled，未 commit／push／merge／deploy。
