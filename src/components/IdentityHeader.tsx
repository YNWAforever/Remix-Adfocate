import type { ReactNode } from "react";

/** Avatar (image or initial) + display name, with a children slot (level block / chip)
 *  and an optional right-aligned actions slot (edit / sign-out). Shared by both pages. */
export function IdentityHeader({
  name,
  avatarUrl,
  children,
  actions,
}: {
  name: string;
  avatarUrl?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const initial = (name?.[0] ?? "?").toUpperCase();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="truncate font-display text-2xl font-bold">{name}</h1>
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-col gap-2">{actions}</div> : null}
    </div>
  );
}
