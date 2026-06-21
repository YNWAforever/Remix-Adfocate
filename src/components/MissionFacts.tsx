import { Star, Users, Clock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Mission } from "@/lib/queries/kocmax";
import { spotsLeft, eligibility } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

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

export function MissionFacts({ mission, creatorLevel, isTrusted = true }: { mission: Mission; creatorLevel?: string | null; isTrusted?: boolean }) {
  const { t } = useI18n();
  const left = spotsLeft(mission.quota, mission.filled);
  const elig = eligibility(mission.required_level, creatorLevel, isTrusted);
  const reward = mission.cash_reward
    ? `${t("app.mission.factRewardValue", { pts: mission.points_reward })} · HK$${mission.cash_reward}`
    : t("app.mission.factRewardValue", { pts: mission.points_reward });
  return (
    <section className="grid grid-cols-2 gap-3">
      <Fact icon={<Star size={18} />} label={t("app.mission.factReward")} value={reward} />
      <Fact icon={<Users size={18} />} label={t("app.mission.factQuota")} value={left > 0 ? t("app.mission.spotsLeft", { n: left }) : t("app.mission.spotsFull")} ok={left > 0} />
      <Fact icon={<Clock size={18} />} label={t("app.mission.factDeadline")} value={mission.deadline ? mission.deadline.slice(0, 10) : t("app.mission.noDeadline")} />
      <Fact icon={<ShieldCheck size={18} />} label={t("app.mission.factEligibility")} value={t(elig.labelKey, elig.params)} ok={elig.qualified} />
    </section>
  );
}
