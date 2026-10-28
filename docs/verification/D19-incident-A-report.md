# D19 已批准 A：Q1–Q3 唯讀查證結果

**結論仍是：目前證據不足以可靠精確還原三筆。** 新讀取已確認三筆現況及有界依賴，但沒有取得可信、帶ID的完整事前像；原 `closed_at`／`updated_at` 仍UNKNOWN。**不是宣稱所有地方都沒有備份，也不是永久不可能還原。**

本輪已執行你明確批准的A；Q1有部分來源受權限限制、Q2沒有找到可採信前像、Q3已完成指定可見範圍的讀取。B1／B2／C仍未批准。事故OPEN／未還原，releaseHOLD，provider disabled；沒有commit／push／merge／deploy，也沒有重跑pristine驗收。

## 身份及唯讀邊界

[Identity gate](D19-incident-A-identity.json)：原project`adfocate-r1-shaped-20261023`、同一API／DB container IDs／images、network／127.0.0.1:56521/56522及data volume均相符；volume自2026-10-22T18:04:12Z存在，**這是live volume建立時間，不是該時刻備份**。[Postflight](D19-incident-A-identity-after.json)仍是同一target。先完成metadata gate才建立任何SQL connection；不用Auth／業務API client。

每次SQL前重驗exact DB metadata；所有成功讀取的`transaction_read_only=on`，`search_path=pg_catalog`，10秒statement／2秒lock timeout，只做SELECT。前3次pSQL使用default local socket，另外核對PGHOST／PGPORT／PGSERVICE未設外部路由；之後明確固定同容器`/var/run/postgresql:5432`。見[route check](D19-incident-A-psql-route-check.json)及[read journal](D19-incident-A-read-journal.json)。沒有business RPC、role/grant/membership變更、backup建立、slot peek/advance、WAL decode、server／daemon start/stop/restart或資料寫入。

Source fingerprint `9812cc7755dd6443f8fa4b39bc92e6c26536b54e15ba1c0cbc494815375dd5e1`／353 records，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`、branch `codex/adfocate-r1-pilot-20261023`。產品／測試／SQL source不改；原16／194、full1982及pristine2cases是已保存checkpoint，今輪沒有重跑或產生新驗收PASS。

## Q1：身份及可讀歷史來源 — 部分完成，server files受阻

- 2個project-labelled/name-filtered volumes只辨識到現有live DB／storage資源，沒有可採信的point-in-time before image。只查同project metadata；不掃其他project／磁碟。
- 既有CLI project目錄核對project／ports，排除secret子樹；2個非secret檔名metadata，0個backup-named files。這只代表該目錄，不代表全機／外部backup不存在。
- 目前`archive_mode=off`、archive command未設定、`log_statement=ddl`、logging collector off、track commit timestamp off；`wal_level=logical`但目前logical slots為0。**目前設定不證明事故時相同；logical capability不等於有可讀完整old tuple。**
- [pg_stat_file拒絕](D19-incident-A-server-file-denial.json)：DB role明確沒有此server-file metadata權限。該statement中未返回的backup marker／WAL metadata全部保持UNKNOWN；沒有改grant、切換DB role或用OS路徑繞過。後續只讀獨立catalog views及Docker stdout log API，不讀被拒的PGDATA／WAL檔案。

來源：[catalog](D19-incident-A-q1-catalog.json)、[recovery catalog](D19-incident-A-q1-recovery-catalog.json)、[project inventory](D19-incident-A-q1-project-inventory.json)。未提供的外部／未標記snapshot、base-backup／WAL鏈及不可讀server-file前像仍UNKNOWN。

## Q2：可信事前像 — 可讀來源沒有找到

- 三個app audit渠道`operator_audit_events`／`mission_workflow_events`／`staff_access_audit`，針對三個exact ID／JSON literal引用，各自matched count=0。沒有輸出actor、Auth、notes、reason或payload原文。
- 原DB／API的現存Docker logs，在批准前像時窗掃描DB420＋API5592，共6012行；DB0個ID命中，API3個命中。[結構核對](D19-incident-A-q2-api-log-structure.json)證實是HTTP access records，沒有完整、帶ID的campaign row body。第二次結構核對的stream SHA與原掃描完全相同；沒有保存raw URI／headers／body。
- 這些是**目前仍留存的Docker log**；不保證涵蓋已輪替、外部或未匯出audit。純request reference、statement、schema default、fixture值、hash集合或新pristine結果，都不能代替原欄位值。

來源：[operator audit](D19-incident-A-q2-audit-operator.json)、[workflow audit](D19-incident-A-q2-audit-workflow.json)、[staff audit](D19-incident-A-q2-audit-staff.json)、[DB log](D19-incident-A-q2-database-log-scan.json)、[API log](D19-incident-A-q2-api-log-scan.json)。

## Q3：三筆現況、可見性及依賴 — 已確認指定範圍

T = **2026-10-24T07:12:04.875188Z（香港15:12:04.875188）**。下表T／T為目前`closed_at`／`updated_at`；不是事前值。所有row屬原workspace`00000000-0000-0000-0000-0000000000aa`。

T 是直接讀到的欄位時間；三筆與原 RPC 的關聯有事後 hash／執行紀錄佐證，歸因屬強佐證推論。缺乏帶 ID 的事前像或對應 audit，因此不能把 T 當作獨立取得的精確 transaction 開始／提交時間，也不能反推出原欄位值。

| Campaign ID | 目前status | closed_at／updated_at | 目前完整row MD5（AFTER） | missions／participants／snapshots／notifications引用 |
| --- | --- | --- | --- | --- |
| `937131f9-5417-4ab4-aebd-a5714681f6dd` | closed | T／T | `5c7ac86b9595bcb533e1655d1a67e0e5` | 0／0／0／0 |
| `9e2d04e2-cafb-4ff6-988b-348f0279bba3` | closed | T／T | `06f22d67db0ec6a8c5e85efdfb663812` | 0／0／0／0 |
| `d80d80dc-4833-4ab2-9e30-48efaef68d1d` | closed | T／T | `ef813976a7295c6a2d22e3aaf7fed5cb` | 0／0／0／0 |

初次與最後讀取完全相同。三個新keyed **AFTER** hash均在既有post-incident及post-recovery vector中；不能拿來配成三個原缺失 **BEFORE** hash，更不能反推原timestamp。只證明這幾個保存點的end-state一致，不能保證期間沒有暫態改動。

現在campaign user trigger=0；3個inbound FKs皆ON DELETE CASCADE，分別campaign_missions／campaign_participants／campaign_rank_snapshots，每ID的row count都0。通知的已知`entity_type=campaign`／`entity_id`引用也是0。[可見性](D19-incident-A-q3-query-visibility.json)確認8個已查public relations均可SELECT、`row_security_active=false`，不是RLS造成假空白。**0只涵蓋這些明確predicate／relations，不代表沒有任何encoded、自由文字、外部或文件引用。** 今輪不刪任何row。

來源：[current rows](D19-incident-A-q3-current-rows.json)、[final rows](D19-incident-A-q3-final-rows.json)、[schema/FK/trigger](D19-incident-A-q3-campaign-schema.json)、[依賴摘要](D19-incident-A-dependency-recovery-summary.json)、[after-hash佐證](D19-incident-A-q3-after-hash-corroboration.json)。

## 更新後的處置決定

| 決定 | 現在狀態 | 最小下一步／不能自動做甚麼 |
| --- | --- | --- |
| **繼續以可靠還原為優先** | 尚欠可信事前像 | 請現有DB／backup資料持有人提供已可讀的事前snapshot／完整old-tuple來源reference或三筆投影：target/volume lineage、時間／digest、3IDs、三欄原值及完整row hash/provenance。憑證留本機，不要無關Creator/Auth內容。若要新recovery clone或新權限，必須另交exact scope批准；不會用grant／OS旁路自行讀被拒資料 |
| **B1 驗收用途隔離** | 未批准；仍可另選 | 只把舊shaped target排除後續acceptance、保留forensics；不改／刪row、不停止容器。不是還原或物理network隔離；B2新target／fixture／E2E另批，不能為了繼續開發就當作已還原 |
| **C exact3-row還原** | **仍不具備條件** | 需要可信原值及ID→原缺失hash mapping、新current fingerprints、exact3-ID／3欄manifest與transaction驗證／rollback計劃，然後另批。現在的AFTER hash、0依賴、或接受偏差均不滿足C |

具體decision inputs見[next decisions](D19-incident-A-next-decisions.json)。可選B1的明確文字仍是：「批准B1：舊shaped target只保留鑑證用途，禁止後續驗收重用；不還原、不刪除、不停止容器、不關閉事故。B2新target／fixture／E2E仍另批。」**今輪沒有把它當作已批准。**

## R1及交付狀態

[更新後的剩餘驗收清單](D19-incident-A-r1-checklist.json)保留依賴、完成條件及未跑旅程；[原清單](D19-incident-decision-r1-checklist.json)原封保存。本輪只更新事實，不提升驗收結果：

- R1-01：A唯讀範圍已做，有明確權限限制；事故處置／驗證決定仍未完成。
- R1-02：原target身份可供本輪forensics，不等於污染已還原或適合當乾淨E2E target。
- R1-04/05/06：role8／core9／Edge5及完整funded legacy→active→修稿→proof→operator完成→雙方／finance reload pending reward旅程，仍是原source/time的歷史證據，今輪沒有更新。後續必要角色／browser驗收仍須核准可信target與exact fixture manifest。
- R1-07：pristine原兩global RPC cases／neutrality證據原封保留，不重跑；不能用它解除舊事故。
- D15四堂核准內容、具名advisor owner／裝置／hosted、正式staff membership／role銜接均仍blocked。staff登入成功但membership=0的scope限制沒有移除。
- **當前仍NOT R1 verified、事故OPEN／未還原、releaseHOLD、provider disabled。** 沒有新部署／pilot／付款／訊息／AI provider操作。

13個成功READ ONLY SQL session；2個中止（server-file權限拒絕、一次query token構造錯誤）及一次SQL前guard拒絕均保留於[read journal](D19-incident-A-read-journal.json)／[錯誤紀錄](logs/D19-incident-A-readonly-errors.log)。已完成的 receipt 直接沿用；Q3 的最終穩定性讀取另有紀錄，沒有自動重試已完成的查詢，guard 未放寬。這些是鑑證讀取，不是13個產品驗收測試。

[Machine report](D19-incident-A-delivery.json)、[逐筆findings](D19-incident-A-case-findings.json)、[來源hash](D19-incident-A-evidence-sources.json)、[adfocate-delivery.json](adfocate-delivery.json)已更新。只改文件／證據；原incident、原decision包、107case／CSV及pristine證據不覆寫。文件before-images可供review；沒有執行任何DB rollback。

## 文件回退及完整性

本輪只更新兩個既有共用文件（`adfocate-delivery.json`、`adfocate-task-ledger.md`）及 evidence seal，並新增 `D19-incident-A-*` 證據。產品、測試、migration、CSV、107 項 case results 及原事故／pristine 文件保持不變。

文件回退可使用 [原 delivery](D19-incident-A-prior-adfocate-delivery.json)、[原 task ledger](D19-incident-A-prior-adfocate-task-ledger.md) 的逐位元副本；[原 evidence seal](D19-incident-A-prior-evidence-integrity.json)只作核對，不應在仍保留新文件時直接覆蓋現行 seal。回退文件後須按實際保留檔案重新計算 seal，並保留本輪事故證據。沒有執行文件回退或資料庫 rollback。

[本輪完整性檢查](D19-incident-A-integrity.json)核對 source、原證據、case/task 紀錄、查證 receipts 及允許範圍；它不是新的產品驗收。

核對指令：在目前 worktree 執行 `python docs/verification/D19-incident-A-check-records.py`。此 [核對腳本](D19-incident-A-check-records.py)只讀本機資料及 Git 狀態，再更新本輪文件 seal；不連 Docker／DB／Auth／API。見[核對輸出](logs/D19-incident-A-document-check.log)及[本輪變更清單](D19-incident-A-changed-files.json)。

本輪後續已備妥[事前像最小交接稿](D19-incident-A-source-request.md)及[待填格式](D19-incident-A-source-template.json)。尚未收到來源，沒有新增 runtime 查詢或對外發送；原 Q1–Q3 結論不變。
