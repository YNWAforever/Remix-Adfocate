import type { ReactNode } from "react";

export function FilterPills({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  renderLabel?: (value: string) => ReactNode;
}) {
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
            {renderLabel ? renderLabel(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

export function FilterPillsMulti({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  renderLabel?: (value: string) => ReactNode;
}) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(opt)}
            className={`filter-pill shrink-0 rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm ${active ? "bg-[var(--color-acid)] font-bold" : "bg-white"}`}
          >
            {renderLabel ? renderLabel(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}
