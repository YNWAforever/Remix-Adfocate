export function FilterPills({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={`filter-pill shrink-0 rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm ${active ? "bg-[var(--color-acid)] font-bold" : "bg-white"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
