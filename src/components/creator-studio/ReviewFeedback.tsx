import type { WorkItem } from "@/lib/queries/creatorStudio";

export function ReviewFeedback({ workItem }: { workItem: WorkItem }) {
  if (workItem.reviewFeedback.status === "unavailable") return <section aria-label="Review feedback" className="rounded-[var(--radius)] border border-[var(--color-ink)] bg-white p-3 text-sm"><h2 className="font-heading font-bold">Review feedback</h2><p className="mt-2">Review feedback is temporarily unavailable.</p></section>;
  const feedback = workItem.reviewFeedback.value;
  return <section aria-label="Review feedback" className="rounded-[var(--radius)] border border-[var(--color-ink)] bg-white p-3 text-sm"><h2 className="font-heading font-bold">Review feedback</h2>{feedback.length === 0 ? <p className="mt-2 text-[var(--color-soft-ink)]">No review feedback yet.</p> : <ul className="mt-2 space-y-2">{feedback.map((item) => <li key={item.id} className="rounded-lg bg-[var(--color-muted,#E4E4E4)] p-2"><p>{item.message}</p><span className="text-xs capitalize">{item.state.replaceAll("_", " ")}</span></li>)}</ul>}{workItem.state === "approved" ? <p className="mt-2 font-semibold">This deliverable is approved.</p> : null}</section>;
}
