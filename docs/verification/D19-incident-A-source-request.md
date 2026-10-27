# D19 三筆 campaign：事前像最小交接稿

本文件是供本機 review 的交接稿，未發送給任何人，亦不構成事前證據或還原授權。現有 A 查證結果不變：仍無可信、帶 ID 的事前像，C 不具備條件。

## 可直接交給現有資料持有人的要求

請提供**既有、已可讀**的事前 snapshot／audit full-old-tuple／備份 export reference 或本機路徑，僅涵蓋以下三個原 campaign ID。請勿建立 recovery clone、改角色／grant 或經 OS 路徑讀取先前被拒的 server files；如需要這些動作，先另外提出 exact scope。

| 原 campaign ID | 要求的事前欄位 | 現有可信原值 |
| --- | --- | --- |
| `937131f9-5417-4ab4-aebd-a5714681f6dd` | `status`、`closed_at`、`updated_at`及原完整 row digest | UNKNOWN |
| `9e2d04e2-cafb-4ff6-988b-348f0279bba3` | `status`、`closed_at`、`updated_at`及原完整 row digest | UNKNOWN |
| `d80d80dc-4833-4ab2-9e30-48efaef68d1d` | `status`、`closed_at`、`updated_at`及原完整 row digest | UNKNOWN |

所需來源資料：

1. 來源 reference／路徑、持有人或既有授權 reference，以及與原 project `adfocate-r1-shaped-20261023`／data volume 的 lineage。
2. Capture／transaction time（含時區）及足以證明來源早於原受影響執行的紀錄。檔名日期、目前 live volume 建立時間及目前 row 時間均不足以證明。
3. 三個 exact ID 各自的原 `status`、`closed_at`、`updated_at`；區分 SQL NULL、缺欄及 UNKNOWN。不要把推論的 active、目前 AFTER 值、schema default 或新 fixture 值填成原值。
4. 原完整 row 的 MD5 與來源／計算方法證明，能將三個 ID 與原缺失 MD5 集合一對一配對。必須沿用原保存基線的 PostgreSQL JSONB serialization／historical schema；不能拿三欄投影的 hash 或新檔案 SHA256 冒充原 row digest。
5. 提供檔案時附內容 SHA256 供完整性核對。它不能單獨證明內容真確或取代可信來源；不必輸出完整 row 的無關個人內容，可由持有人在已可讀原來源計算完整 row digest，再只交三欄、ID、digest 及 provenance。

憑證、tokens、Auth rows 及無關 Creator／作者內容留在原環境。此要求沒有授權新增資料、備份、clone 或權限；不要求把 secrets 貼到聊天。

## 收到來源後的核對條件

[待填 JSON 格式](D19-incident-A-source-template.json)刻意保留 UNKNOWN；不是證據。只有來源實際記錄 SQL NULL 時才可填 JSON null。填妥格式本身也不算 verified。

| 順序 | 必須核對 | 不符合時 |
| --- | --- | --- |
| 1 | exact reference／可讀範圍、原 target lineage、持有人及時間 provenance | 保留 UNKNOWN；不擴大搜尋或權限 |
| 2 | 來源早於原事故；如需要進入另一 target，先有該 target 的身份與唯讀授權 | 不建立 client／clone，不把檔名日期當證明 |
| 3 | exact 三個 ID、三欄原值、NULL 語義及來源間一致性 | 不以缺欄／default／新 fixture 補值 |
| 4 | 原完整 row digest 的算法／schema 與三個缺失 BEFORE hashes 一對一配對 | 不將 AFTER hashes、投影 hash 或 hash 集合猜配成 ID mapping |
| 5 | 獨立核對 provenance；發現與原 RPC predicate 不一致時記錄矛盾 | 不為配合還原而改證據 |

即使上述核對全通過，也只會使 C 的 exact 三筆還原 manifest 可供 review。執行前仍需另有明確批准、fresh current fingerprints／CAS、transaction 與 rollback 驗證計劃；本輪不做任何還原或寫入。

## 沒有來源時的明確選擇

- 繼續以可靠還原為優先：提供既有來源 reference，或明確記錄目前沒有來源；事故維持 OPEN，不能宣稱永久無法還原或所有地方均無備份。
- 另行選 B1：可使用原 [B1 批准文字](D19-incident-A-next-decisions.json)。它只將舊 target 限為鑑證用途並排除後續 acceptance 重用；不是還原、刪除、實體 network 隔離、事故關閉或 release 放行。B2 新 target／fixture／E2E 仍須另批。
- 維持 HOLD：不做資料處置，等待新證據。

沒有從「continue」推定 B1／B2／C 已批准。尚未收到新的事前來源；沒有聯絡或發送要求給任何人。

## 本輪結果與回退

本輪只準備文件及待填格式；沒有新 SQL／Docker／API／Auth 讀取、產品測試或 pristine 重跑。D15、advisor owner／裝置／hosted、正式 staff blockers、provider disabled、事故 OPEN／release HOLD 全部保留。原 [A 查證報告](D19-incident-A-report.md)及[剩餘驗收清單](D19-incident-A-r1-checklist.json)仍適用。

新增文件可以在保留事故紀錄下撤回；共用文件的本輪 before copies 保存在 `.codex-tmp/D19-incident-A-source-request-before/`，如需文件回退須重新計算 evidence seal。沒有執行任何文件回退或 DB rollback。見[文件核對](D19-incident-A-source-verification.json)。
