import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/wallet/earnings")({
  beforeLoad: () => { throw redirect({ to: "/wallet" }); },
});
