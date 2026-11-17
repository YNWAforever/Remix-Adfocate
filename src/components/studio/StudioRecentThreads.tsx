import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStudioThreads } from "@/lib/studio/queries";
import type { StudioTopic } from "@/lib/studio/types";
import { StudioSkeleton } from "./StudioSkeleton";
import { StudioError, useStudioText } from "./StudioPrimitives";

const TOPIC_LABELS: Record<StudioTopic, [string, string]> = {
  creation: ["內容創作", "Creation"],
  missions: ["接任務", "Missions"],
  performance: ["成效檢討", "Performance"],
  rewards: ["積分與獎賞", "Rewards"],
};

function shortDate(value: string, lang: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-HK" : "zh-HK", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

/**
 * The last three discussions, so the page can pick up where the creator left
 * off instead of starting cold every visit.
 */
export function StudioRecentThreads() {
  const tx = useStudioText();
  const { lang } = useI18n();
  const threads = useStudioThreads();
  const badges = useQuery({
    queryKey: ["studio", "badges"],
    queryFn: () => apiFetch<{ badges: Array<{ id: string }> }>("/studio/badges"),
  });
  const rows = threads.data?.threads.slice(0, 3) ?? [];

  return (
    <section className="s-card s-stack">
      <h3>{tx("接著上次的靈感", "Pick up where you left off")}</h3>

      {threads.data === undefined && !threads.isError ? (
        <div className="s-stack">
          <StudioSkeleton width="85%" height={16} />
          <StudioSkeleton width="70%" height={16} />
        </div>
      ) : threads.isError ? (
        <StudioError onRetry={() => void threads.refetch()} />
      ) : rows.length === 0 ? (
        <p className="s-muted">
          {tx("第一段討論，從你的一句話開始。", "Your first chat starts with one question.")}
        </p>
      ) : (
        rows.map((thread) => {
          const topic = TOPIC_LABELS[thread.topic] ?? TOPIC_LABELS.creation;
          return (
            <Link
              key={thread.id}
              to="/studio"
              search={{ thread: thread.id }}
              className="s-source"
            >
              <h3>{thread.title}</h3>
              <span className="s-row">
                <span className="s-tag ghost">{tx(...topic)}</span>
                <span className="s-tag ghost">{shortDate(thread.created_at, lang)}</span>
              </span>
            </Link>
          );
        })
      )}

      <Link to="/studio" className="s-btn">{tx("所有討論與成果", "All chats & briefs")}</Link>
      {badges.data?.badges.length ? (
        <div className="s-achievement">🏅 {tx("第一份核實成果", "First verified creation")}</div>
      ) : null}
    </section>
  );
}
