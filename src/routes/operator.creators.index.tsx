import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/operator/creators/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/creators", search: (prev) => prev as never });
  },
});
