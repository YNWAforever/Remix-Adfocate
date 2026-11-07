import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { initializeActivationAnalytics } from "./lib/activationAnalytics";
import "./styles.css";

// Select before importing the account tree: its module initialization binds Auth.
const receiptDocument = /^\/integration-deletion(?:\/|$)/.test(window.location.pathname);
export const application = (receiptDocument ? import("./receipt-router") : import("./router")).then(({ router, queryClient }) => {
  if (!receiptDocument) initializeActivationAnalytics();
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return root;
});
