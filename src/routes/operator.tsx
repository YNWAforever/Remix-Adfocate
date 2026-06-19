import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /operator/* detail pages (creator detail, mission selection). MUST
// render <Outlet/> or the children won't show. The /operator index redirects to
// the unified /admin dashboard (see operator.index.tsx).
export const Route = createFileRoute("/operator")({ component: () => <Outlet /> });
