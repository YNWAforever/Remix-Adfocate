import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { initializeActivationAnalytics } from "./lib/activationAnalytics";
import "./styles.css";

async function boot() {
const preview = import.meta.env.DEV && import.meta.env.VITE_STUDIO_FIXTURE === "true"
  ? await (await import("./test/studioPreview")).installStudioPreview() : null;
const { router, queryClient } = await import("./router");
if (!preview) initializeActivationAnalytics();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
preview?.(path => router.navigate({ to:path }), async()=>{await queryClient.invalidateQueries();await router.invalidate();});
}
void boot();
