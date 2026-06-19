import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/operator/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/applications" });
  },
});
