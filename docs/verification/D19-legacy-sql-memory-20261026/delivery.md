# D19 legacy SQL 本機補驗 — 2026-10-26

本輪補齊 UC-A11 的 SQL core 證據，原 application source 788 筆、73 migrations 及待批 C2 manifest 全部不變。七項 standalone Node22/PGlite 記憶體測試與指定 lint 通過，沒有發現需要修改的 SQL。先前 native full 2129 pass / 0 fail / 363 gated skips（292 files）保留於原 source，今輪未重跑；七項獨立測試不能併稱為新的 full-suite count。

執行前先驗證不可覆寫的 memory:// descriptor，之後才 import／建立 engine。每項獨立 engine，跨交易 retry 使用分開的 autocommit statements；七個 engine 全部關閉，external fetch attempts 0。這沒有建立物理 target、Auth subject、session 或持久 fixture。

| 行為 | 直接讀回證據 |
| --- | --- |
| 同一 cash-bearing submission 首次批准、原 payload 重試、不同合法 note/rating 重試 | points 250、XP 185（原35＋100＋5星50）、cash 47.25、budget 452.75；三種 ledger 各1筆。saved note/rating/revision 保留原結果，九類資料 hash 在重試後相同 |
| budget 不足／late cash-ledger fault／final Creator XP fault | 拒絕後九類資料完整讀回等於事前；記憶體內受控修正後只批准一次，重試不增發 |
| pre-guard 無效 URL | 真正 evidence guard 拒絕，九類資料不變；fixture 是自行建立的合成值，完全不是事故事前像 |
| non-cash legacy mission | points 250、XP 135；cash 0、budget 500，cash/budget ledger 0；retry 不變 |
| execute ACL | 原 SQL 的 anon/authenticated 拒絕，service_role 允許；不等於真實 Auth、membership 或 RLS 驗收 |

`sql-profile.json` 綁定七份原 SQL raw hashes、23個 selected original statements、bootstrap／profile digest。只載入原 table、final approve_submission、evidence guard 及 ACL；不是完整73 migration／trigger replay。沒有驗證 GoTrue/PostgREST/Hono、實際 Auth／membership／RLS、多連線併發、campaign/notification/level hooks、API persistScores 或 browser rating/note reload。沒有測 active pending flow，這些 legacy 記憶體 credits 不構成 pending reward 財務 neutrality。

可重現命令（在 worktree root，使用新的 label 保留舊 receipt）：

```powershell
python docs/verification/D19-legacy-sql-memory-20261026/run-memory-verification.py test memory-review-next
python docs/verification/D19-legacy-sql-memory-20261026/run-memory-verification.py lint lint-review-next
python docs/verification/D19-legacy-sql-memory-20261026/verify-memory.py
```

首輪及最後一輪的實際 Node command、version、physical/commit resource readings、terminal exit、TAP log、artifact source revisions 與 engine readbacks 全部保留。首輪就已通過，沒有虛構 RED 或產品修復。

本輪只更新 UC-A11 新層，107個 originalAuditResult／expected 等原欄及 D15 UC-C18／A51 整行不變。完整剩餘清單、依賴與缺少的角色／browser facets 在 remaining-acceptance.json；C2 application runtime 仍待原問題的明確批准，不能沿用已完成696e批准，也不能用 C2 跑 legacy replay。

D15 教材、具名 advisor owner／實體裝置／manual AT／hosted、正式 staff scope、audit ZIP 原檔核實及其餘 R1 facets 保持未完成。模型介面沿用上一輪已觀察的 GPT-6.1 Sol／Max；沒有切換或推測 ID。

事故 OPEN、未還原；舊 shaped target 只供鑑證，沒有查詢或驗收重用。release HOLD、真實 provider disabled。未 commit／push／merge／deploy，未改正式資料。Rollback 只涉及 exact-before local metadata；沒有物理資料或 schema rollback。
