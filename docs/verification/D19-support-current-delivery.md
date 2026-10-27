# D19 support 補驗：部分通過，事故及全域案例仍 open

**發布／pilot HOLD，未部署，不能稱當前整份R1 verified。** 本輪修復的是測試fixture與安全邊界，產品API／UI／SQL沒有改動。最重要的限制是：第一輪全域RPC誤改3筆既有隔離campaign；事故保持OPEN／未還原。後續成功與新基線不能抹去這件事。

## 版本與實作

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，沒有reset／commit。Prior fingerprint `cdf8597d00d4cf716823a420296cb0e40ba1fa13e0fa11ca7feb735f8f04c996`，current `aee0d8891982cf1b2b5613008b585aabfe1f816abb0edd982dfb0679d8a53436`／351 records。34個source差異只限test／fixture runner及ESLint。既有engine／membership gate／單workspace主鍵與所有SQL不變。[Source binding](D19-support-current-runtime-source-binding.json)、[patch](D19-support-current-changes.patch)、[changed files](D19-support-current-changed-files.json)。

既有support launcher新增`--fresh`：新UUID workspace、namespace與六個mission fixture；31筆舊Academy seed只讀，不虛構核准課堂。沿用exact-ID service transport，兩個無參數全域campaign RPC會在delegate前拒絕，不能靠一個owned parent宣稱整庫操作已隔離。只有fixture constants／selector改為新scope，原斷言及案例保留。

## 實際測試與資料分層

| Evidence | Result | 限制 |
| --- | --- | --- |
| 新scope RED→GREEN |8fail/1pass→9pass| SDK/client建立前檢查 |
| 全域RPC guard RED→GREEN |3fail/1pass→4pass| 原global SQL／tests未刪 |
| combined targeted |46pass| mock／fixture及proof invariant契約 |
| 第一輪 real support |439pass／2fail；proof3pass| 品牌名／seed slugs仍寫死；3筆舊campaign被global close改動 |
| 第二輪 |中斷，無完整support report| 原log／IDs保留，不能算PASS |
| daemon停止後preflight |拒絕，無client／setup| 不是integration PASS |
| 最後安全範圍 |439pass／0fail／2blocked；proof3pass| 不執行close_due_campaigns及snapshot_campaign_leaderboards |
| fresh完整offline |1967pass／363 gated skip／0fail／277 files| 原16＋194通過，skip不是pass |
| type／lint／manifest／build |全部exit0| lint首次archive Node globals問題已留初始log；只補globals、沒有刪rule |

完整suite初跑有13 fail：11項涉及sandbox loopback/temp權限，2項是私有runner缺少npm_execpath。原失敗報告保留；修正執行環境後[失敗組32項全綠](D19-support-current-red-green-evidence.json)，再用相同source／assertions重跑完整suite得到1967／363／0fail。沒有為此修改產品或測試斷言。

最後namespace `1d64ebf8-cbf6-4179-96ea-c14241d7207c`。Commands、逐assertion、counts及raw report hashes見 [test results](D19-support-current-test-results.json)、[full](D19-support-current-full-results.json)及各gate JSON。Support counts包含契約／mock與真實DB案例，並非439個browser或SQL操作。Providers封鎖／mock，沒有付費AI、真實通知／邀請／發布或付款。之前role8／core9／Edge5與funded pending neutrality保留在其原source；本輪沒有重跑整段browser，應用程式／schema bytes相同的關係有逐檔證據，沒有把campaign settlement fixture當pending neutrality。

## 隔離事故與後續驗證

[Identity](D19-support-current-identity.json)：兩個原container／image／project／network及API／DB loopback mapping先於client/setup核實。Empty56421/56422，shaped56521/56522。全程沒有正式target讀寫或正式staff修改。

[第一輪事故](D19-support-current-preservation-incident.json)／[候選IDs與時間窗](D19-support-current-incident-campaigns.json)：原87筆campaign中有3筆在初輪被`close_due_campaigns()`由active關閉。完整初始row-hash比對只缺這3筆，其他原public/Auth user rows（含財務rows）仍在；該SQL不settle／付款。原closed_at／updated_at bytes未捕捉，不能猜值還原。沒有reset、down、刪舊ID或擅自restore。

後續獨立基線與[after](D19-support-current-postrecovery-schema-after.json)相同，表示該輪沒有額外改舊資料；**不是宣稱初始事故已修好／從未發生**。Manifest42，history empty72／shaped56；objects／RPC／ACL／RLS／history相同，沒有新migration或舊checksum修改。Schema完整觀察與初始失敗均保留。

另以[獨立新增child範圍查詢](D19-support-current-snapshot-extent.json)核對第一輪snapshot RPC：舊campaign下新增rank snapshot rows為0。Row-hash比對本身只識別既有row的修改／刪除，不把它當新增children的檢查。

兩個global RPC驗收需另有核准的pristine DB／project，原測試保留完整，不能mock成PASS。Incident需owner按候選IDs／既有證據決定後續處置；後續fixture baseline不取代原基線。[Retention](D19-support-current-fixture-retention.json)記錄三輪實際／部分setup及exact IDs，只處理本輪成功建立的IDs，immutable workflow／access actors保留。

## Case與blocker

20 tasks／107 audit cases／28 findings／12 product cases、1645原CSV欄位及originalAuditResult保留。[Coverage](D19-support-current-case-coverage.json)不是107個browser PASS；UC-S04的全域DB部分明確blocked。D15四堂核准內容、具名advisor owner／裝置／hosted、正式staff及provider disabled原限制保留。Next D19：事故owner處置及pristine global-RPC target；其餘D17／D15外部材料仍獨立blocked。

## Rollback

[Checks](D19-support-current-rollback-checks.json)為11份patch的check-only：本輪patch可機械reverse；全部4pass／7需hunk review，沒有實際套用。Review source before-images時保留全域RPC guard，不能讓舊runner恢復對retained targets的無界操作。Source還原不能還原DB rows；初始3筆campaign沒有自動還原。禁止猜值update、廣泛delete、db push/reset/down及修改audit／proof／reward／ledger／history。

[delivery JSON](D19-support-current-delivery.json)、[adfocate-delivery.json](adfocate-delivery.json)、[integrity](D19-support-current-integrity.json)已反映部分驗證與事故，canDeploy／canEnablePilot=false；沒有push／merge／deploy。
