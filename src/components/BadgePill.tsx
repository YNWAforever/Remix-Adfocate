export function BadgePill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-block rounded-full border-[1.5px] border-[var(--color-ink)] bg-[var(--color-acid)] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink)] ${className}`}>
      {children}
    </span>
  );
}
