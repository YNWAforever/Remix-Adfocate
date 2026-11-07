import { createFileRoute, HeadContent } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { IntegrationDeletionStatus, type DeletionStatus } from "@/components/integrations/IntegrationDeletionStatus";

/** Uses the minimal public port only; never bootstraps Auth or reads private integration data. */
export async function readDeletionStatus(receipt: string, request: typeof fetch = fetch): Promise<DeletionStatus> {
  if (!/^[a-f0-9]{32}$/.test(receipt)) return "unknown";
  try {
    const response = await request(`/api/integration-notices/deletion/${receipt}`, {
      method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
    });
    if (response.status === 404) return "unknown";
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body) && "status" in body
      && (body.status === "pending" || body.status === "completed")) return body.status;
  } catch { /* Raw errors/response bodies must never appear on this public page. */ }
  return "unavailable";
}

export const Route = createFileRoute("/integration-deletion/$receipt")({
  loader: ({ params }) => readDeletionStatus(params.receipt),
  staleTime: 0,
  gcTime: 0,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  pendingComponent: () => <ReceiptStatus status="loading"/>,
  errorComponent: () => <ReceiptStatus status="unavailable"/>,
  component: DeletionReceiptPage,
});

function DeletionReceiptPage() {
  return <ReceiptStatus status={Route.useLoaderData()}/>;
}

function ReceiptStatus({ status }: { status: DeletionStatus }) {
  return <>{createPortal(<HeadContent/>, document.head)}<IntegrationDeletionStatus status={status}/></>;
}
