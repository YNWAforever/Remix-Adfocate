import { Star, Users, Clock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { spotsLeft, eligibility } from "@/lib/missionMeta";

function Fact({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok?: boolean }) {
  return (
    <div className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <span className={ok === false ? "text-[var(--color-magenta)]" : "text-[var(--color-ink)]"} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</p>
        <p className="truncate font-heading font-bold">{value}</p>
      </div>
    </div>
  );
}

export function MissionFacts({ mission, creatorLevel }: { mission: Mission; creatorLevel?: string | null }) {
  const left = spotsLeft(mission.quota, mission.filled);
  const elig = eligibility(mission.required_level, creatorLevel);
  const reward = `${mission.points_reward} 積分${mission.cash_reward ? ` · HK$${mission.cash_reward}` : ""}`;
  return (
    <section className="grid grid-cols-2 gap-3">
      <Fact icon={<Star size={18} />} label="獎勵" value={reward} />
      <Fact icon={<Users size={18} />} label="名額" value={left > 0 ? `尚餘 ${left} 個` : "額滿"} ok={left > 0} />
      <Fact icon={<Clock size={18} />} label="截止" value={mission.deadline ? mission.deadline.slice(0, 10) : "無截止日期"} />
      <Fact icon={<ShieldCheck size={18} />} label="資格" value={elig.label} ok={elig.qualified} />
    </section>
  );
}
