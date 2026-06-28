import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout-only parent for /campaigns: list lives in _app.campaigns.index.tsx and
// detail in _app.campaigns.$slug.tsx. Must render <Outlet/> so child routes mount.
export const Route = createFileRoute("/_app/campaigns")({ component: () => <Outlet /> });
