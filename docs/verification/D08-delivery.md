# D08 交付紀錄

D08 已完成 local 與 disposable runtime 驗證；未部署。沿用 `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`，沒有 commit、push 或 merge。

首頁沿用 activation 與 `deriveNextAction`，優先顯示修稿等可執行工作、截止日期及直達 work item 的 CTA。等候審批不顯示加入／重交 CTA；pending reward 獨立說明不可提現，optional draft 不會搶走其 CTA。`proof_verified` 顯示等待完成核對。503 保留有標示的舊資料；401／403／404 隱藏受保護快取；錯誤可重試且與空清單分開。手機固定首頁、找任務、我的任務、錢包、更多；更多保留八個既有入口，桌面加入我的任務。D04 的錢包及舊連結 redirect 已保留重驗。

## 四層結果

| code | test | deployment | runtime |
| --- | --- | --- | --- |
| 已實作並完成作者 self-review | targeted 124/124；full suite 1658 pass / 312 skip；16 audit、194 契約均通過 | 未部署 | 2/2 真實 disposable Edge 測試；非 production |

Node 22.23.4 完整 suite：202 files passed / 37 skipped，合共 1,970 tests；312 integration skips 不當成通過。必要 Auth/API/DB/UI 由本輪真實瀏覽器流程覆蓋。type-check、lint、Node22 build、diff-check 通過；四項既有 lint warnings、既有路由 exports warning 及大 bundle warning 仍存在。詳細命令／counts／logs 見 [JSON](D08-delivery.json)。最初 sandbox npm registry ENOTFOUND 的兩個啟動紀錄已保留；其後用 cached Node22 offline 完成，沒有將未執行當作測試失敗或成功。

## E2E、scope 與 neutrality

本輪 `75f15f46-88a3-4a39-a9c4-3af61b24ec88`：Creator 真實本機登入及 UI 加入、草稿、送審、修稿、proof／correction；operator 以既有真實 Auth session 審批、核實及完成。首頁三個狀態均硬重載後，以一次 CTA 到正確交付／reward 頁；前後 workflow、work items、pending reward、history 完全相同。[狀態證據](D08-home-roundtrip.json)。Creator viewport 360px，CTA 至少 44px且首頁無水平溢出；手機導航 360/390/768px、更多八個入口可鍵盤 Enter，錢包及 alias 硬重載有效。[導航證據](D08-navigation.json)。

雙方刷新讀到同一 frozen pending reward 及歷史。完成前後 XP=10、points=50、可提現=0、cash/point/budget ledger counts=0、redemption=0、budget=null、inventory=[] 全部相等。[Neutrality](D08-browser-neutrality.json)。登入既有 welcome XP 0→10 發生在 measured handoff 前，沒有正規化抹去。沒有新增付款、ledger 或扣預算功能。

第二次 browser attempt 在完成對話框未出現而逾時，保留 [失敗摘要](D08-browser-attempt2-summary.json)。該次對話框未出現的根因未確立，沒有因而修改 operator 產品程式。在測試中先重載 operator 的持久化 proof 投影，再開完成確認；最終 2/2 通過，未延長 timeout、使用 forced click 或降低持久化 assertions。首次 desktop Creator + mobile navigation 2/2 與失敗／最終 logs 均保留。

## Schema、case coverage 及未測範圍

D08 沒有 schema／RPC／grants／RLS／migration 變更；既有 [manifest](../../supabase/release-manifest.json) digest `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86` 與 [R1 diff](schema-diff.json) 保留，沒有重跑或更改正式庫。實際 container/project/image/network/loopback identity 在 client/setup 前核實，使用先前授權的 `adfocate-r1-empty-20261023`。合成資料保留 exact IDs供檢視，沒有 blanket cleanup、seed/reset 或 membership 修改。

N01 通過；UC-C03/C04/C09 追加本輪證據；UC-Q01 僅記錄 D08 頁面／導航的 bounded partial，D17 全站可存取性及效能仍開放。原 107 cases、28 findings 及所有原 CSV 欄位保留；只更新 newResult 等新增欄位。Safari/WebKit、實體手機、200% zoom、負載／p95／整站 accessibility、真實外部 provider、正式 runtime／CI／部署及七日 pilot 均未驗證。

## Changed files

本輪相對先前 R1 fingerprint 有 19 個 code/test/script 檔案改動，詳見 [D08 JSON](D08-delivery.json)；整個保留 dirty worktree 見 [changed files](changed-files.json)。

- `e2e/creator-navigation.spec.ts`
- `e2e/creator-operator-mission.spec.ts`
- `scripts/audit/run-browser.mjs`
- `src/components/ActiveMissionSummary.tsx`
- `src/components/BottomNav.test.tsx`
- `src/components/BottomNav.tsx`
- `src/components/CreatorWorkHome.test.tsx`
- `src/components/CreatorWorkHome.tsx`
- `src/components/NextBestActionCard.tsx`
- `src/components/SideNav.test.tsx`
- `src/components/navItems.ts`
- `src/lib/creatorActivation.ts`
- `src/lib/i18n.dict.ts`
- `src/lib/queries/activeMission.ts`
- `src/lib/useCreatorActivation.ts`
- `src/routes/-_app.home.test.tsx`
- `src/routes/_app.home.tsx`
- `src/routes/_app.more.tsx`
- `src/test/creatorWorkWorkspace.ts`

目前 code fingerprint：`51f635f49b22960943af450c65d924ebae5b0aca4d8795a2c3cfae1c36a89dbb`。先前 checkpoint：`219fff96a67905b1e2ce7293f5e39bda35295427319e9d89c1d79c3d39af99be`，保留於 [prior fingerprint](D08-prior-code-fingerprint.json)。

## Rollback

本輪未部署，無遠端 rollback 動作。若要撤回 D08，只反轉上述 D08 介面、workspace query options 適配及導航／More route 的差異；保留原有 R1 dirty changes、五個 forward migrations、membership gate 及 reward engine。依 prior fingerprint／D08 diff 檢視逐檔還原，避免整個 worktree reset。保留本輪 fixture exact IDs及歷史，不用 trigger bypass／廣泛 delete。還原後重跑 affected tests、type-check、build及必要 disposable browser flow。

下一項：D09，任務列表 DTO、分類與資格一致。本輪沒有啟動 D09。
