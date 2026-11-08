import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { Route as rootRoute } from "./routes/__root";
import { Route as receiptRoute } from "./routes/integration-deletion.$receipt";

// Separate from the generated account/marketing tree and its Auth bootstrap.
// Reuses the real root without constructing a Supabase client.
export const queryClient = new QueryClient();
const receipt = receiptRoute.update({
  id: "/integration-deletion/$receipt", path: "/integration-deletion/$receipt", getParentRoute: () => rootRoute,
} as never);
export const router = createRouter({ routeTree: rootRoute.addChildren([receipt]), context: { queryClient } });
