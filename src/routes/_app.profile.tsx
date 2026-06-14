import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FilterPillsMulti } from "@/components/FilterPills";
import { useMe, useUpdateProfile, type SocialHandle } from "@/lib/queries/kocmax";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_app/profile")({ component: Profile });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Profile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const update = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function startEdit() {
    const d = me.data;
    setDisplayName(d?.display_name ?? "");
    setCategories(d?.categories ?? []);
    const seeded: Record<string, string> = {};
    for (const s of d?.social_handles ?? []) seeded[s.platform] = s.handle;
    setHandles(seeded);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const existing = me.data?.social_handles ?? [];
    // Rebuild from the non-empty handle inputs, preserving followers/verified per platform.
    const social_handles: SocialHandle[] = PLATFORMS.flatMap((p) => {
      const handle = (handles[p] ?? "").trim();
      if (!handle) return [];
      const prev = existing.find((s) => s.platform === p);
      return [{ platform: p, handle, followers: prev?.followers ?? null, verified: prev?.verified ?? false }];
    });
    try {
      await update.mutateAsync({ display_name: displayName.trim() || undefined, categories, social_handles });
      setEditing(false);
    } catch {
      setError("儲存失敗，請重試");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    qc.removeQueries({ queryKey: ["me"] });
    navigate({ to: "/login" });
  }

  async function copyReferral() {
    const code = me.data?.referral_code;
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const d = me.data;
  const initial = (d.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="flex items-center gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
          {d.avatar_url ? <img src={d.avatar_url} alt="" className="h-full w-full object-cover" /> : initial}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{d.display_name ?? "KOC"}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
              {d.level}
            </span>
            <span className="text-sm text-[var(--color-soft-ink)]">{d.xp} XP</span>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {!editing ? (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">內容範疇</h2>
            {d.categories?.length ? (
              <div className="flex flex-wrap gap-2">
                {d.categories.map((c) => (
                  <span key={c} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">社交帳號</h2>
            {d.social_handles?.length ? (
              <ul className="space-y-1">
                {d.social_handles.map((s) => (
                  <li
                    key={s.platform}
                    className="flex items-center justify-between rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-heading font-semibold">{s.platform}</span>
                    <span className="text-[var(--color-soft-ink)]">{s.handle}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
            )}
          </section>

          <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
            <h2 className="font-heading font-bold">我的邀請碼</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold tracking-widest">{d.referral_code ?? "—"}</span>
              <button
                type="button"
                onClick={copyReferral}
                disabled={!d.referral_code}
                className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
              >
                {copied ? "已複製" : "複製"}
              </button>
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">邀請朋友，各得 200 分</p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Link
              to="/my"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              我的任務
            </Link>
            <Link
              to="/redemption"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              兌換記錄
            </Link>
          </section>

          <div className="space-y-3">
            <button
              type="button"
              onClick={startEdit}
              className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
            >
              編輯
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold text-[var(--color-magenta)]"
            >
              登出
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">顯示名稱</h2>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-label="顯示名稱"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">內容範疇</h2>
            <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">社交帳號</h2>
            <div className="space-y-2">
              {PLATFORMS.map((p) => (
                <input
                  key={p}
                  value={handles[p] ?? ""}
                  onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                  placeholder={`${p} 帳號`}
                  aria-label={`${p} 帳號`}
                  className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
                />
              ))}
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
            >
              {update.isPending ? "儲存中…" : "儲存"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
