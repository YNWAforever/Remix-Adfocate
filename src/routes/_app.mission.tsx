import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout-only parent for /mission: the list lives in _app.mission.index.tsx and the
// detail in _app.mission.$missionSlug.tsx. This MUST render <Outlet/> or the child
// routes (notably the mission detail) have nowhere to mount. Mirrors _app.redemption.tsx.
export const Route = createFileRoute("/_app/mission")({ component: () => <Outlet /> });
