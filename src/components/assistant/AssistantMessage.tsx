import type { AssistantCitation } from "@/lib/queries/kocmax";

export function AssistantMessage({ side, text, citations }: { side: "user" | "assistant"; text: string; citations?: AssistantCitation[] }) {
  const mine = side === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 text-sm ${mine ? "bg-[var(--color-acid)]" : "bg-white"}`}>
        <p className="whitespace-pre-wrap">{text}</p>
        {citations && citations.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {citations.map((c) => (
              <li key={`${c.sourceType}:${c.sourceRef}`} className="rounded-full border border-[var(--color-ink)] px-2 py-0.5 text-[10px] text-[var(--color-soft-ink)]">
                {c.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
