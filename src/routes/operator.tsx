import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, getAdminSecret, setAdminSecret, clearAdminSecret, AdminAuthError } from "@/lib/admin";

export const Route = createFileRoute("/operator")({ component: OperatorApplications });

type Application = {
  id: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

function OperatorApplications() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [input, setInput] = useState("");
  const qc = useQueryClient();

  const apps = useQuery({
    queryKey: ["admin-applications"],
    enabled: !!secret,
    retry: false,
    queryFn: () => adminFetch<{ applications: Application[] }>("/admin/applications"),
  });

  // A bad/stale secret → 401 → AdminAuthError. Drop back to the prompt.
  useEffect(() => {
    if (apps.error instanceof AdminAuthError) { clearAdminSecret(); setSecret(null); }
  }, [apps.error]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      adminFetch(`/admin/applications/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-applications"] }),
  });

  if (!secret) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <h1 className="font-display text-xl font-bold">營運後台</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">輸入管理密碼以檢視申請</p>
        <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="ADMIN_SECRET" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2" />
        <button onClick={() => { setAdminSecret(input); setSecret(input); }} className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold">進入</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-xl font-bold">待審批申請</h1>
      {apps.isLoading && <p className="text-sm">載入中…</p>}
      {apps.data?.applications.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批申請</p>}
      {apps.data?.applications.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div>
            <p className="font-heading font-bold">{a.creators.display_name}</p>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
          </div>
          <div className="flex gap-2">
            <button aria-label="接受" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">接受</button>
            <button aria-label="拒絕" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
