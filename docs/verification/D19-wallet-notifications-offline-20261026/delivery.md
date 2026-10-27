# D19 GATE14：錢包及通知離線補驗

新增 **8/8、exit0**，lint及嚴格TypeScript通過。App/SQL共789檔、C2 source及待批manifest均不變。上一輪native full2133/0/363（293files）保留，今輪未重跑；新8項不加入其總數。

| 案例 | 真正程式觀察；Auth/DB明確fake |
| --- | --- |
| UC-C13 | 400分、+250/-50交易及HK$47.25可用／HK$15待審分開顯示；其他Creator資料不顯示；500提示後explicit query refresh恢復；actual workspace middleware拒401／403 |
| UC-C14 | 49/50差1分，disabled按鈕有accessible description；缺貨0即禁用；scripted SELECT更新49→50及stock2→0後正確重算。沒有confirm、redeem RPC、扣分或發碼 |
| UC-C36 | 真正badge/list/hook/apiFetch/Hono，owned2項mark-read→0，更新數2；重複+foreign IDs回傳1再0，另一收件人不變；actual NotificationCard產生精確/my/submission href |

不是整案例或R1 PASS。Scripted Auth與creator-RLS邊界不是真實Auth/RLS；沒有新target、SDK、SQL、Auth subject、session、fixture、provider或browser。Realtime只有stub，/me為完整明示fixture。沒有真通知producer、click-through後實際work-item、付款／redemption replay、pending reward business neutrality。C14改動的是記憶體SELECT fixture，readback逐項記錄，不能冒作財務相等證據。

首跑8項已通過；驗證檔兩項lint已修。獨立type config先缺route IDs，再缺app router Register；最終保留root所有includes加本test，不降低compiler要求。原log、config/source snapshots保留；補direct HTTP trace後同8 assertions再通過，最後type include-only更改只重跑TypeScript。

107個原稽核欄位保留，C13/C14/C36只增加offline facets；A45只澄清舊e8 C2已批准且停於preclaim、新f5仍待批，沒有新驗收credit。D15教材、advisor owner／device／hosted／manual AT、正式staff限制維持。事故OPEN／未還原，舊shaped只供鑑證，release HOLD，provider disabled。未commit／push／merge／deploy，未部署。

所有commands、Node22、fresh RAM、terminal receipts、原始readback、範圍及限制見gates.json／readback-summary.json；rollback.json只有選擇性本機檔案／metadata復原，不涉及資料或資源。下一步仍是既有f5 C2批准，proposal與source沒有改動，勿重問同一批准或重跑pristine／696e。
