import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ProgressColor = "pink" | "mint" | "yellow" | "blue";

const colorGradients: Record<ProgressColor, string> = {
  pink: "from-primary to-rose-hover",
  mint: "from-mint to-[#7EE6C4]",
  yellow: "from-butter to-[#FFE566]",
  blue: "from-sky to-[#7EC8FD]",
};

export function ProgressBar({
  value,
  label,
  color = "pink",
  className,
}: {
  value: number;
  label?: string;
  color?: ProgressColor;
  className?: string;
}) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.min(100, Math.max(0, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-heading font-semibold text-soft-ink">{label}</span>
          <span className="font-mono text-[11px] text-soft-ink">{Math.round(value)}%</span>
        </div>
      )}
      <div className="xp-bar w-full">
        <div
          className={`xp-bar-fill bg-gradient-to-r ${colorGradients[color]}`}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}
