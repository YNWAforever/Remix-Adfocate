# D13 交付紀錄

D13 已完成 local／disposable 驗證；未部署。Worktree `C:\Users\laich\Documents\Adfocate\worktrees\adfocate-r1-20261023`，branch `codex/adfocate-r1-pilot-20261023`，HEAD `7cfa3dc84c821719a4dff754229a591c81786c53`。沒有 commit、push 或 merge。執行介面核實 gpt-6.1-sol，沒有切換模型。

登入統一 Adfocate、同一 email 步驟選密碼／登入連結；原 Google／WhatsApp、註冊、重設能力保留。安全返回跨 onboarding／替代連結保留；錯誤及過期可恢復。Profile／Passport 使用同一 server projection，分開來源、同步、擁有權及時間；舊自填 verified 不提升擁有權，衝突保留兩來源。沒有自動搬移或覆寫 canonical handle。

| code | test | deployment | runtime |
| --- | --- | --- | --- |
| 已實作，沿用既有 Auth/RPC/repo/service/RLS | 126 targeted；full 1736 pass / 332 skip；16 audit + 194 contracts 全綠 | 未部署 | 8 API、4 Edge 通過；PKCE UI exchange 明示 mock |

完整命令、counts、gates、失敗分類及 logs：[D13 JSON](D13-delivery.json)。4 個既有 app lint warnings、route exports／bundle size warning 保留。`eslint .` 之前掃描 private 備份及 emitted JS，現在只排除 `.codex-tmp/**`；[實際 app rules 完全相同](D13-eslint-scope.json)。測試後只移除多餘 EOF 空行，emitted JS [完全相同](D13-post-runtime-format.json)；之後完整 gates 再跑。跳過項目不視為通過。

## 持久化及 E2E

最終 run `dc8e3b52-ee86-4f22-aa0a-87a2cbf8d8d1`：真實本機密碼登入→原請求 Profile；取消無寫入；503 保留輸入→重試保存→刷新；canonical/legacy 原樣、Passport projection 相同。公開 Passport 只展示批准 highlight；另一個匿名 context 可讀、撤銷後顯示 unavailable。Storage 真的寫入並選取 owned 一像素合成 PNG；portfolio 與 public snapshot 實際保存。[API](D13-api-contract.json)、[Profile](D13-profile-roundtrip.json)、[登入恢復](D13-auth-recovery.json)、[onboarding](D13-onboarding-roundtrip.json)。[登入截圖](D13-login.png)、[社交狀態截圖](D13-social-passport.png)，390px 無水平溢出。

真實 local Auth 驗證錯誤／不存在帳戶一致錯誤、單次 link 重放失敗、owned recovery timestamp 過期及改密碼後舊憑證失效。舊 access/refresh 均拒絕，觀察 JWT lifetime 3600 秒。[Auth 設定](D13-auth-runtime-config.json) 綁定相同 project/network，SMTP 只指向本機 Inbucket。沒有改 Auth 設定或正式 policy。PKCE UI 使用 mocked verifier/exchange 安裝有效 owned session；之後 Auth updateUser 真的成功；這並非完整真實電郵／PKCE provider 驗收。[UI](D13-recovery-ui.json)。

## 財務、schema、coverage

Profile／社交／媒體／重設前後資金與 ledgers、預算、inventory 相同。唯一預期例外是既有迎新獎賞：API actor 原始50→150、四個並發及重放只增加100與1行；新UI actor 0→100、刷新不再提供領取。沒有重寫 baseline、使命 pending reward、cash/payout/withdrawal 或 budget debit。[實際快照](D13-browser-neutrality.json)。

無 schema／migration／RPC／grant／RLS 變更。Manifest digest `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86`；[readonly objects/RPC/grants/RLS/history](D13-schema-observation.json) 為8個objects／67 history rows。SQL checksums 保留。所有本輪 [exact IDs及Storage objects保留](D13-fixture-retention.json)，沒有 reset／廣泛 delete／cleanup；未跑帶 shared DEMO seed/cleanup 的舊 broad integration。

F09／F13 與12個 D13 cases 更新 newResult；原107 cases、28 findings、CSV原欄位、originalAuditResult、D08/D09/D12 records 保留。所有實際限制見 JSON；真實 Google／WhatsApp／社交 provider／郵件投遞、CI／production、Safari/WebKit、實機、200%zoom、全站a11y、load及並行profile編輯未認證。Canonical synced/verified 是合成 seed state，不是假稱真實 provider 證明。之前完整角色handoff證據按原fingerprint保留，本輪沒有重走proof／reward完成。

## Changed files及 rollback

本輪 37 個 code/test/script/config 差異，fingerprint `f3850e65a73f5de44781022f1d81c574f80207987e964a9ac99f84a8a84f81fd`，前輪 `879169bdea26e901bb3151971d2ad9b1ede7603d8ee71a535db31388cc1ad412`。[D13獨立patch](D13-changes.patch)、[完整inventory](changed-files.json)、[prior checkpoint](D13-prior-code-fingerprint.json)。

- `e2e/creator-identity-profile.spec.ts`
- `eslint.config.js`
- `scripts/audit/run-identity.mjs`
- `scripts/audit/run-integration.mjs`
- `server/lib/social/passportSocial.test.ts`
- `server/lib/social/passportSocial.ts`
- `server/routes/me.ts`
- `server/routes/social.ts`
- `server/test/audit-identity-contract.test.ts`
- `src/components/AuthFeedback.return.test.tsx`
- `src/components/AuthFeedback.tsx`
- `src/components/PassportTrustSummary.test.tsx`
- `src/components/PassportTrustSummary.tsx`
- `src/components/SocialAccountSummary.tsx`
- `src/components/SocialTrustPanel.test.tsx`
- `src/components/SocialTrustPanel.tsx`
- `src/lib/auth-flow.test.ts`
- `src/lib/auth-flow.ts`
- `src/lib/authFeedback.ts`
- `src/lib/i18n.dict.ts`
- `src/lib/queries/kocmax.ts`
- `src/lib/socialAccountPresentation.test.ts`
- `src/lib/socialAccountPresentation.ts`
- `src/routes/-_app.auth.callback.test.tsx`
- `src/routes/-_app.auth.reset-password.test.tsx`
- `src/routes/-_app.login.test.tsx`
- `src/routes/-_app.onboarding.test.tsx`
- `src/routes/-_app.passport.test.tsx`
- `src/routes/-_app.profile.test.tsx`
- `src/routes/-app.auth.callback.test.tsx`
- `src/routes/_app.auth.callback.tsx`
- `src/routes/_app.auth.reset-password.tsx`
- `src/routes/_app.login.tsx`
- `src/routes/_app.onboarding.tsx`
- `src/routes/_app.passport.tsx`
- `src/routes/_app.profile.tsx`
- `src/routes/_app.tsx`

## Rollback

未部署，沒有遠端rollback。以D13 patch逐hunk反轉；保留R0/R1/D08/D09/D12 dirty工作、會員gate及既有forward migrations。新增檔案只限本輪清單，禁止整個worktree reset。無反向migration；保留所有owned fixture IDs及歷史，無seed/reset/delete。還原後跑identity/受影響契約、type/build及必要disposable flow。

下一項 D14：修正公開承諾及未完成課程顯示；本輪未開始。
