D19 B2 runtime 已獲批准並實際執行，但 infrastructure bootstrap 未通過；R1 尚未 verified。

我最初選錯了 DB 初始化 user。新 volume 的 bootstrap superuser（OID10）因此使用映像原本要降權的角色名稱；映像執行降權時被 PostgreSQL 保護拒絕。這是本輪執行設定錯誤。原始失敗log、向前補角色的嘗試、部分初始化與最後唯讀catalog均保留。PostgreSQL對bootstrap superuser的限制見[官方17版glossary](https://www.postgresql.org/docs/17/glossary.html#GLOSSARY-BOOTSTRAP-SUPERUSER)。不跳過安全降權，不做未review的角色對調、catalog修改或reset。

| 層次 | 結果 |
| --- | --- |
| Code | 既有779 source fingerprint `d13fe2b7e8b9838972b8d93881dc17e8ccfc2795bc133b01cdc4f1a35426f893` 未改；新增只讀configuration guard及獨立hash綁定的recovery提案 |
| Test | 新guard6 pass／0 fail；2個CLI fail-closed probe通過。舊同source full2047／0／363 skip、原16／194保留，沒有重跑 |
| Deployment | 未部署；沒有commit／push／merge／deploy |
| Runtime | 1 project／1 network／1 volume／5 containers已建立。DB運行、其他4個stopped；app migration／fixture／role8／core9／browser5均未執行 |

實際public tables／views／RPC／policies=0、Auth users=0、application migration history不存在。Auth schema有7筆映像系統migration history。不能把這些值當pending reward neutrality；本輪未建立業務fixture，亦未測完整角色交接或refresh persistence。Schema缺失來自新target bootstrap未完成，與正式staff membership0的scope問題分開。

資源exact IDs、engine、ports、mounts、config hashes及最後catalog見 `adfocate-d19-b2-20261025-b0db3134/final-infrastructure-readback.json`。原network預設pool耗盡後，唯讀核對34個Docker subnets及22條非default host routes，才選無重疊的10.251.219.0/28；沒有改舊network或daemon。只讀過既有network IPAM metadata以避免衝突；沒有讀舊target的業務資料、keys、env或logs，也沒有其lifecycle操作。

唯一的新DB container是 `cc5bebd05d4f77658ee2647b2449a5188e8425d2ae2057864389a6c23c0bbbb1`；volume `adfocate-d19-b2-20261025-b0db3134-db-data`；network `6a680bf2f30acc8c7e38dc379e612a02786977f3ecb10af878eeb47d04f83b79`。另外4個containers與完整清單見機讀紀錄。沒有自動shutdown／刪除／recreate；目前volume保留實際部分初始化狀態。原3筆campaign事故維持OPEN／unrestored，未把新fixture或本輪系統初始化當成其before image。Pristine兩個全域RPC沒有重跑。

已新增啟動前及post-image角色guard，能拒絕本輪實際錯誤configuration／catalog。正確catalog只作mock驗證；本輪target仍未修復。測試commands、RED6及harness path失敗／最後GREEN6、實際DB exit2／image migration exit3，見 `D19-B2-runtime-gates.json`及logs。所有原始audit結果欄位保留。

建議C1：保留目前B2，另建乾淨target `adfocate-d19-b2-20261025-recovery-4d6ca2c8`，追加1 project／1 volume／1 network／5 containers，全部cached images、fresh secrets及新phase／fixture intent IDs；首次啟動前必須檢查`supabase_admin`初始化user，post-image確認OID10與一般DB role安全屬性，才做原72+conditional9及role8／core9／browser5。

可review的新manifest為 `D19-B2-recovery-runtime-manifest.json`，SHA-256 `257d43f4f8030cab8c84974653d1ce06af14db6a7932bc2f591791aab119cb07`；guard checksum已綁入，authorization template仍false。它是新增資源提案，未建立／未獲runtime批准。C2（只處理本輪failed B2的exact lifecycle／重建）及C3（保留暫緩）的影響與批准條件見 `D19-B2-runtime-disposition-options.json`。沒有為繼續開發而批准全部還原、移除資源或關閉事故。

需要新批准的原因是：原已批准manifest只涵蓋1 project／1 volume／1 network／5 containers，且明定沒有automatic resource shutdown/removal；該allocation已使用。新target或移除重建均超出本輪原scope。現有B2 runtime批准已記錄，不再要求你重批同一份。

D15真實教材、advisor owner／實體裝置／hosted、正式staff銜接限制、Node22／模型介面未重驗的限制均保留；真實provider disabled、release HOLD，未部署。剩餘驗收與rollback分別見 `D19-B2-runtime-remaining-acceptance.json`、`D19-B2-runtime-rollback.json`。
