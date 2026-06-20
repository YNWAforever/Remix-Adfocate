import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/tnc")({
  beforeLoad: () => { throw redirect({ to: "/legal/terms" }); },
});
