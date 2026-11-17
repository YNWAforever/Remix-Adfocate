import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { Gift } from "@/lib/queries/kocmax";
import { useBalance, useGifts } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { StudioSkeleton } from "./StudioSkeleton";
import { StudioError, useStudioText } from "./StudioPrimitives";

function availableGifts(gifts: Gift[] | undefined): Gift[] {
  return (gifts ?? [])
    .filter((gift) => gift.stock_remaining > 0 && gift.status === "available")
    .sort((left, right) => left.points_cost - right.points_cost);
}

/**
 * Turns the reward teaser into a real next step: the cheapest reward the
 * creator can claim now, or how many points remain before the next one.
 */
export function StudioRewardCard() {
  const tx = useStudioText();
  const { lang } = useI18n();
  const gifts = useGifts();
  const balance = useBalance();
  const points = balance.data?.balance;
  const catalogue = availableGifts(gifts.data);
  const affordable = points === undefined ? [] : catalogue.filter((gift) => gift.points_cost <= points);
  const next = points === undefined ? [] : catalogue.filter((gift) => gift.points_cost > points);
  const claimable = affordable.at(-1);
  const upcoming = next[0];
  const rewardKind = claimable ? "claimable" : upcoming ? "next" : "empty";

  return (
    <section className="s-card peach s-stack">
      <div className="s-row">
        <span className="s-task-icon" aria-hidden>🎁</span>
        <h3>{tx("下一份小獎賞", "Your next little reward")}</h3>
      </div>

      {gifts.data === undefined && !gifts.isError ? (
        <div className="s-stack">
          <StudioSkeleton width="55%" height={16} />
          <StudioSkeleton width="80%" height={12} />
        </div>
      ) : gifts.isError ? (
        <StudioError onRetry={() => void gifts.refetch()} />
      ) : claimable ? (
        <>
          <p>{claimable.name}</p>
          <small className="s-muted">
            {tx(`而家有 ${points!.toLocaleString()} 分，可以即刻兌換。`, `You have ${points!.toLocaleString()} points — ready to claim.`)}
          </small>
        </>
      ) : upcoming ? (
        <>
          <p>{upcoming.name}</p>
          <progress
            value={points ?? 0}
            max={upcoming.points_cost}
            aria-label={tx("兌換進度", "Reward progress")}
          />
          <small className="s-muted">
            {tx(
              `還差 ${(upcoming.points_cost - (points ?? 0)).toLocaleString()} 分`,
              `${(upcoming.points_cost - (points ?? 0)).toLocaleString()} points to go`,
            )}
          </small>
        </>
      ) : (
        <p className="s-muted">
          {tx("暫時未有可兌換獎賞，遲啲再嚟睇。", "No rewards are open right now — check back soon.")}
        </p>
      )}

      <Link
        to="/redemption"
        className="s-btn"
        onClick={() => trackActivationEvent("reward_card_clicked", { locale: lang, rewardKind })}
      >
        {claimable ? tx("去兌換", "Claim now") : tx("逛逛獎賞商店", "Explore rewards")}
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}
