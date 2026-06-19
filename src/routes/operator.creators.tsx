import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /operator/creators/:id. MUST render <Outlet/>. The list view moved
// to the /admin/creators tab; /operator/creators redirects there (operator.creators.index.tsx).
export const Route = createFileRoute("/operator/creators")({ component: () => <Outlet /> });
