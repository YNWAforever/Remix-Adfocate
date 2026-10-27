# D14 交付紀錄

D14 已完成本輪 local／disposable 的 truthful-preview 範圍；未部署。原 UC-C18／UC-A51「四堂課」驗收仍未完成，交 D15，不能因顯示「內容準備中」就標成 PASS。

Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`；branch `codex/adfocate-r1-pilot-20261023`；HEAD／比較基線 `7cfa3dc84c821719a4dff754229a591c81786c53`。執行介面核實 gpt-6.1-sol，沒有切換模型。沒有 commit、push、merge 或 deploy；既有 dirty 工作保留。

| Code | Test | Deployment | Runtime |
| --- | --- | --- | --- |
| 已實作，延伸原 public／Academy／LEVELS／資格引擎 | 66 targeted；full 1756 pass / 338 skip；16 audit + 194 contracts 全綠 | 未部署 | 6 real API、4 Edge 通過；503 錯誤路徑明示 transport fake |

## 行為及持久化證據

3,840 XP 由 canonical LEVELS 計算為 L2，下一級 L3／6,000 XP；當級進度46%，尚餘2,160 XP。公開示範履歷／統計／收入明示示範，移除無來源平台成績及真實提款承諾；中英文皆寫清 pending reward 不等於付款。聯絡五種表單都只是預覽，不送出、不保存、不聲稱收件；預覽及切換 tab 保留輸入，刷新後沒有虛假成功狀態。[公開UI八格](D14-public-ui.json)、[聯絡表單](D14-contact-ui.json)。

Operator 在真實本機 Auth／API／DB 建立 resource 正文→重載→發布→重新讀取；track／resource 篩選一致。現有 editor title／excerpt／body 有 label，resource 也可編輯正文；已發布修改只送更改欄位，避免重送鎖定 slug。409 比較最新版本後保留自己的修改，未修改欄位承接最新值；錯誤不清空輸入。Creator 刷新仍讀到同一已發布正文；空正文顯示準備中及獨立標明簡介，不從 duration 推算課數。XP／社交信任 gate 及重試保留。[API](D14-api-contract.json)、[作者UI](D14-author-ui.json)、[Creator UI](D14-creator-ui.json)。

最終 run `560c5421-28dc-45f0-bdd5-56f32cffdb02`，既有 disposable project `adfocate-r1-empty-20261023`，在建立 client／setup 前核實 container／image／network／proxy。真實 local session 由 owned Auth fixture 產生並在 browser 沿用；不是外部登入或 provider 驗收。Edge 使用390×844模擬及1280×900 desktop，中英文公開頁；非實機或Safari驗收。503 只在錯誤路徑明示 mock，恢復後讀取真實已持久化資料。完整命令與 logs 見 [JSON](D14-delivery.json)。

## 財務及 schema

兩個 Creator：原始 XP 分別0／6000，積分各50，可提現額0，point／cash／budget ledger皆0，redemptions0，inventory空，budget原始null；前後完全一致。API 建立／發布內容亦 neutral。沒有新增付款、ledger、可提現額或預算扣款。[原始快照](D14-browser-neutrality.json)。

無 schema／migration／RPC／grant／RLS 變更；manifest digest `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86`。本機 history 67列與 D13 相同，`brand_users` 仍是 `PRIMARY KEY (user_id)`。Academy table、14 grants、published-read RLS policy與既有catalog一致；columns另有新鮮唯讀觀察。[Schema manifest/diff](D14-schema-diff.json)、[schema observation](D14-schema-observation.json)。未查正式庫，未執行 db push／reset／migration。4輪fixture共16個Auth IDs、8個workspace IDs及15筆owned內容均保留，包含setup失敗及部分browser輪次；[exact retention](D14-fixture-retention.json)，無清理或廣泛delete。

## 驗證、限制及失敗分類

先建立行為 RED，再最小修改；失敗 counts 及原始 logs 保留。最終 type-check、lint、manifest check、cached Node22 build、targeted、full suite及diff check均通過。完整suite 252 files，skip不當作pass；6項owned integration補上本任務所需，沒有執行帶shared DEMO seed／cleanup的舊broad integration。原16項audit及194既有契約未改、未放寬；原107案例／28findings／CSV原欄位及 originalAuditResult保留。四個既有app lint warning及build路由／bundle warning保留。

首輪integration是fixture誤寫derived `is_trusted`，六項未執行；修正fixture而非改schema。中間browser錯誤為tab role、既有升級dialog與重複toast定位；最終4項全綠、無retry或flaky。曾修正Hero漏取翻譯變數及單測locale切換造成的額外query；未弱化行為assertion。最後runtime、full suite與交付source fingerprint相同，沒有測後改碼。

本輪沒有重跑整套legacy／active proof／reward交接； earlier runtime按各自fingerprint保留，本輪完整suite重新保護16／194。未做CI、正式部署／資料／membership、真實通知／邀請／社交provider、付款／付費AI、實機／Safari／完整a11y／load／多作者race認證。公開承諾縮減須發布owner在真正發布前確認；材料已準備，canDeploy／canEnablePilot仍false。正式課堂內容與持久化進度交D15，不虛構課程。

## Changed files與 rollback

本輪 21 個 code／test／script 差異；fingerprint `27e174353ec8455d0fdfcb795c03724e7f1e85c8598fcdf1097957ef76989c85`；前輪 `f3850e65a73f5de44781022f1d81c574f80207987e964a9ac99f84a8a84f81fd`。[D14獨立patch](D14-changes.patch)、[完整inventory](changed-files.json)、[prior checkpoint](D14-prior-code-fingerprint.json)。

- `e2e/public-claims.spec.ts`
- `scripts/audit/run-integration.mjs`
- `scripts/audit/run-public-claims.mjs`
- `server/routes/academy.ts`
- `server/test/academy-availability.test.ts`
- `server/test/audit-public-claims-contract.test.ts`
- `src/components/AcademyTrackCard.tsx`
- `src/components/admin/AcademyEditor.test.tsx`
- `src/components/admin/AcademyEditor.tsx`
- `src/data/mockData.ts`
- `src/lib/academy.ts`
- `src/lib/i18n.dict.ts`
- `src/routes/-_app.guide.track.$trackId.test.tsx`
- `src/routes/-public-claims.test.tsx`
- `src/routes/_app.guide.track.$trackId.tsx`
- `src/routes/_site.contact.tsx`
- `src/routes/_site.creators.tsx`
- `src/routes/_site.index.tsx`
- `src/routes/_site.tsx`
- `src/routes/admin.academy.$id.tsx`
- `src/routes/admin.academy.index.tsx`

未部署，沒有遠端rollback。若需還原，逐hunk反轉D14 patch及本輪新增清單，保留R0/R1/D08/D09/D12/D13與既有forward migrations；禁止整個worktree reset，不反向migration，不清除retained fixture。還原後重跑受影響契約、type/build及必要owned flow。

下一項 D15：真正的課程單元及持久化進度；本輪未開始。
