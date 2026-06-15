import { useState } from "react";
import { useGenerateHooks, useMe, type Hook } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";

const PLATFORMS: { value: string; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "xiaohongshu", label: "小紅書" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

/** Map a stored social-handle platform string to a HookPlatform value (default instagram). */
export function normalizePlatform(raw?: string | null): string {
  const s = (raw ?? "").toLowerCase();
  if (/(xiaohongshu|xhs|小紅書|小红书|red)/.test(s)) return "xiaohongshu";
  if (/(tiktok|抖音|douyin)/.test(s)) return "tiktok";
  if (/(youtube|yt)/.test(s)) return "youtube";
  return "instagram";
}

export function HookPanel({ missionSlug }: { missionSlug: string }) {
  const me = useMe();
  const gen = useGenerateHooks();
  const [platform, setPlatform] = useState(() => normalizePlatform(me.data?.social_handles?.[0]?.platform));

  return (
    <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="font-heading font-bold">內容靈感</h3>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPlatform(p.value)}
            aria-pressed={platform === p.value}
            className={`rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm font-heading ${platform === p.value ? "bg-[var(--color-acid)]" : "bg-white"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => gen.mutateAsync({ mission_slug: missionSlug, platform })}
        disabled={gen.isPending}
        className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 text-center font-heading font-bold text-[var(--color-ink)]"
      >
        {gen.isPending ? "生成中…" : "生成"}
      </button>
      {gen.isError && <p className="text-sm text-[var(--color-magenta)]">生成失敗，請重試</p>}
      {gen.data && (
        <div className="space-y-2">
          <BadgePill>{gen.data.source === "ai" ? "AI 生成" : "範本"}</BadgePill>
          <ul className="space-y-2">
            {gen.data.hooks.map((h: Hook, i: number) => (
              <li key={i} className="flex items-start gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
                <BadgePill>{h.angle}</BadgePill>
                <p className="flex-1 text-sm">{h.text}</p>
                <button
                  aria-label="複製"
                  onClick={() => navigator.clipboard?.writeText(h.text)}
                  className="shrink-0 rounded border border-[var(--color-ink)] px-2 py-0.5 text-xs"
                >
                  複製
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
