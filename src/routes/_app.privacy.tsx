import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/privacy")({
  beforeLoad: () => { throw redirect({ to: "/legal/privacy" }); },
});
