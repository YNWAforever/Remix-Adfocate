C1 的 DB image 初始化、OID10 角色檢查及五個服務 metadata 已通過。Application bootstrap 及 role/core/browser 仍未執行；R1 未 verified，release HOLD。

原 C1 批准已建立 `adfocate-d19-b2-20261025-recovery-4d6ca2c8`（1 project /1 volume /1 network /5 containers）。所有舊 targets 保留；舊 shaped 僅鑑證。實際 Storage mountinfo 證明 tmpfs 為 rw、256 MiB。只改既有 identity helper 及兩個測試檔，未改 application engine、migration、正式 membership、evidence expiry 或 provider。

- Source：`6285bca02a74bedf3eda7259238366e9023fcc0cae24fe5e7c874ae9dd118d7b`（779 records）；HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，未 commit／push／merge／deploy。
- 新增測試先 RED 3；identity GREEN22；B2 回歸43；最終 current binding25。初次 full2046/12fail/363：1 項舊 manifest 連結、9 項 loopback、2 項暫存檔權限；修正連結後適當權限補跑28/0，最終 full2058/0/363、288 files，含原16及194。4 個既有 lint warnings；type-check／lint／release manifest／ESM 通過。完整 commands、logs、source 綁定見 [gates](D19-C1-gates.json)。Skipped363 是未執行，並非 integration passed。
- [Schema diff](D19-C1-schema-diff.json)：72 source checksum／42 protected entries／bootstrap profile 不變；尚未重播 app72、conditional9、historical checkpoint、full catalog／grants／RLS／history／seed baseline。DB image 前後檢查與 application schema 分開。
- [Case coverage](D19-C1-case-coverage.json)：107 original cases、28 findings、D15 原列保留。C1 role0/core0/browser0，pending reward persistence／financial neutrality **NOT MEASURED**。
- [Rollback](D19-C1-rollback.json)：只列 exact source／metadata before copies；沒有還原、delete、reset、停容器或 cleanup。原3 campaign 事故 OPEN／unrestored，不能把新 fixture 當原值。

下一步是審閱 [同一 C1 target 的 guarded source continuation](D19-C1-source-revision-runtime-manifest.json)，SHA-256 `a0f09af0a7bce75e6842a1d42042ac4471e757c184574d7e5dcf9a23fdc57989`，source `6285bca02a74bedf3eda7259238366e9023fcc0cae24fe5e7c874ae9dd118d7b`。它要求新增資源 **0**，沿用原 UUID／caps／bootstrap profile／8 role／9 core／5 browser＋2 obligations；禁止任何 provision/start/recreate/stop/remove/pull。原批准 hash／收據沒有被改成新 source 的批准。

原 C1 manifest 的 identityAndBootstrapGates 明定「Explicit runtime approval bound to final source/manifest digest before resource create/start」，abort 規則明定「Missing identity/source/profile/lineage/quota or unresolved cap => no client/setup/write」。既有 helper 亦在 client/setup 前檢查 source bytes。這次實際 metadata bug 修正改了 source fingerprint，所以新 manifest／template 保持 unapproved；需明確批准這份 candidate 續跑，不能冒用舊 hash 的 owner reference。通過後依序 full identity/health → sealed app72/catalog/seed baseline → role8 → core9 → browser5 → exact persisted readback／separate finance windows。

[剩餘驗收](D19-C1-remaining-acceptance.json) 分清 R1 與 release/pilot 限制：D15 缺4個核准教材單元；具名 advisor owner、實體裝置／manual AT／Safari及 hosted；正式 staff 已登入但 membership=0 的 scope 問題；current model interface 未核實、Node22 未跑。真實 provider disabled；沒有正式資料／membership 寫入，沒有 pristine 全域 RPC 重跑，也未部署。
