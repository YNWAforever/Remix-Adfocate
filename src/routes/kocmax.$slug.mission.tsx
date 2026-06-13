import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMissions } from "@/lib/queries/kocmax";

export const Route = createFileRoute("/kocmax/$slug/mission")({ component: MissionList });

const CATS = ["全部", "美容", "餐飲", "寵物", "旅遊"] as const;

function MissionList() {
  const { slug } = Route.useParams();
  const [cat, setCat] = useState<string>("全部");
  const { data, isLoading, isError } = useMissions(cat);
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-3 py-1 rounded-full text-sm ${cat === c ? "bg-[var(--color-ink)] text-white" : "bg-white border"}`}>
            {c}
          </button>
        ))}
      </div>
      {isLoading && <div className="skeleton-card h-24" />}
      {isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
      <ul className="space-y-2">
        {data?.map((m) => (
          <li key={m.id}>
            <Link to="/kocmax/$slug/mission/$missionSlug" params={{ slug, missionSlug: m.slug }}
                  className="block rounded border p-3 bg-white">
              <p className="font-medium">{m.title}</p>
              <p className="text-sm">{m.points_reward} 積分 · {m.filled}/{m.quota}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
