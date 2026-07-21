import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { MissionWorkItemView, WorkItemState } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";

type DeliverableNavigatorProps = {
  items: MissionWorkItemView[];
  selectedId: string | null;
  onSelect: (workItemId: string) => void;
};

const STATUS_KEYS: Record<WorkItemState, string> = {
  blocked_by_fulfillment: "app.activeMission.deliverable.status.blockedByDelivery",
  drafting: "app.activeMission.deliverable.status.drafting",
  submitted: "app.activeMission.deliverable.status.submitted",
  under_review: "app.activeMission.deliverable.status.underReview",
  revision_requested: "app.activeMission.deliverable.status.changesRequested",
  approved_to_publish: "app.activeMission.deliverable.status.approvedToPublish",
  cancelled: "app.activeMission.deliverable.status.cancelled",
  expired: "app.activeMission.deliverable.status.expired",
};

export function DeliverableNavigator({ items, selectedId, onSelect }: DeliverableNavigatorProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { t } = useI18n();

  function selectAt(index: number) {
    const item = items[index];
    if (!item) return;
    onSelect(item.id);
    buttonRefs.current.get(item.id)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let targetIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") targetIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") targetIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = items.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    selectAt(targetIndex);
  }

  return (
    <nav aria-label={t("app.activeMission.deliverable.aria")} className="min-w-0">
      <ul className="flex snap-x gap-2 overflow-x-auto overscroll-x-contain pb-2 md:flex-col md:overflow-visible md:pb-0">
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          const status = t(STATUS_KEYS[item.state]);
          return (
            <li key={item.id} className="min-w-[12rem] snap-start md:min-w-0">
              <button
                ref={(node) => {
                  if (node) buttonRefs.current.set(item.id, node);
                  else buttonRefs.current.delete(item.id);
                }}
                type="button"
                aria-current={selected ? "step" : undefined}
                aria-label={`${item.title}, ${status}`}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`min-h-11 w-full touch-manipulation rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 text-left hover:bg-[var(--color-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${selected ? "bg-[var(--color-acid)] shadow-[3px_3px_0_0_var(--color-ink)]" : "bg-white"}`}
              >
                <span className="block break-words font-heading font-bold">{item.title}</span>
                <span className="mt-1 block text-xs font-semibold text-[var(--color-soft-ink)]">{status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
