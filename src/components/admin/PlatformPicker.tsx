import { ArrayInput } from "./ArrayInput";

const KNOWN = ["xiaohongshu", "instagram", "tiktok", "youtube"] as const;

type Props = { value: string[]; onChange: (next: string[]) => void };

export function PlatformPicker({ value, onChange }: Props) {
  const toggle = (p: string) =>
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);

  const custom = value.filter((p) => !KNOWN.includes(p as (typeof KNOWN)[number]));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {KNOWN.map((p) => {
          const on = value.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={`rounded-full border-2 border-[var(--color-ink)] px-3 py-0.5 text-sm ${
                on ? "bg-[var(--color-acid)]" : "bg-white"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      <ArrayInput
        value={custom}
        onChange={(next) => onChange([...value.filter((p) => KNOWN.includes(p as (typeof KNOWN)[number])), ...next])}
        placeholder="其他平台…"
      />
    </div>
  );
}
