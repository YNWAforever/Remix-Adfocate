import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicPassportView } from "@/components/PublicPassportView";
import { usePublicPassport } from "@/lib/queries/kocmax";

export const Route = createFileRoute("/passport/$token")({ component: PublicPassportRoute });

function PublicPassportRoute() {
  const { token } = useParams({ from: "/passport/$token" });
  const passport = usePublicPassport(token);

  if (passport.isLoading) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl">
        <p className="text-sm text-[var(--color-soft-ink)]">Loading passport...</p>
      </div>
    );
  }

  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl">
        <p className="text-sm text-[var(--color-magenta)]">Passport unavailable</p>
      </div>
    );
  }

  return <PublicPassportView passport={passport.data} />;
}
