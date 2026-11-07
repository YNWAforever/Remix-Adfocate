import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { useMe } from "@/lib/queries/kocmax";
import type { IntegrationConnection, IntegrationResource } from "./types";
import { integrationKeys, useConnections, useDrivePicker, useIntegrationCommand, useIntegrationResources } from "./queries";

vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: vi.fn() }));
const fetchMock = vi.mocked(apiFetch);
const clients: QueryClient[] = [];
const connection: IntegrationConnection = { id: "drive-1", provider: "google_drive", label: "Mock Drive", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file"], generation: 1, lastSyncAt: null, expiresAt: "2099-01-01T00:00:00Z", lastError: null, sampleOnly: true, providerRevocation: "not_requested" };
const resource: IntegrationResource = { id: "resource-1", connectionId: "drive-1", externalId: "mock-doc", title: "PRIVATE TITLE", mimeType: "text/plain", version: "v1", selected: true, canDownload: true, rights: "owned", availability: "available", excerpt: "PRIVATE EXCERPT", metrics: {}, observedAt: "2026-10-31T00:00:00Z", fetchedAt: "2026-10-31T00:00:00Z", coverage: { region: null, language: null, partial: false }, sampleOnly: true };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(integrationKeys.list(), { mode: "mock", connections: [connection] });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("private integration queries", () => {
  it.each(["late fixture response", "abort rejection"])("loads D0 on the initial StrictMode creator mount despite a cancelled %s", async outcome => {
    let resolveOwner!: (value: unknown) => void;
    const pendingOwner = new Promise(resolve => { resolveOwner = resolve; });
    const requests: { signal: AbortSignal; resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
    fetchMock.mockImplementation(async (path, init) => {
      if (path === "/me") return pendingOwner;
      if (path === "/me/integrations") return new Promise((resolve, reject) => {
        requests.push({ signal: init!.signal as AbortSignal, resolve, reject });
      });
      throw new Error(`Unexpected ${path}`);
    });
    const { client } = setup(); client.removeQueries();
    function CreatorMount({ children }: { children: ReactNode }) {
      const me = useMe();
      return me.data ? children : null;
    }
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}><CreatorMount>{children}</CreatorMount></QueryClientProvider></StrictMode>;
    const view = renderHook(() => useConnections(), { wrapper });
    await act(async () => { resolveOwner({ id: "creator-a" }); });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    const pilot = { stage: "D0", externalAccess: false };
    const response = { mode: "live_pilot", pilot, connections: [] };
    await act(async () => {
      if (outcome === "late fixture response") requests[0].resolve(response);
      else requests[0].reject(new DOMException("Cancelled", "AbortError"));
    });
    await act(async () => { requests[1].resolve(response); });
    await waitFor(() => expect(view.result.current.data).toEqual(response));
    expect(view.result.current.isError).toBe(false);
    expect(client.getQueryState(integrationKeys.list("creator-a"))?.status).toBe("success");
    expect(requests).toHaveLength(2);
  });

  it("retains the D0 disclosure while fencing private reads and non-lifecycle commands", async () => {
    const pilot = { stage: "D0", externalAccess: false };
    fetchMock.mockResolvedValue({ mode: "live_pilot", pilot, connections: [connection] });
    const { client, wrapper } = setup(); client.removeQueries();
    const view = renderHook(() => useConnections(), { wrapper });
    await waitFor(() => expect(view.result.current.data?.mode).toBe("live_pilot"));
    expect(view.result.current.data).toMatchObject({ pilot });
    fetchMock.mockClear();
    const reads = renderHook(() => ({ resources: useIntegrationResources(connection), picker: useDrivePicker(connection), command: useIntegrationCommand() }), { wrapper });
    await act(async () => {
      await reads.result.current.resources.refetch().catch(() => {});
      await reads.result.current.picker.refetch().catch(() => {});
      await reads.result.current.command.mutateAsync({ action: "start", provider: "google_drive" }).catch(() => {});
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reads.result.current.resources.data).toBeUndefined();
    expect(reads.result.current.picker.data).toBeUndefined();
    expect(client.getQueryData(integrationKeys.list())).toMatchObject({ mode: "live_pilot", pilot });
  });

  it("blocks in-progress revocation and never starts new consent against the same provider", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.list(), { mode: "mock", connections: [{ ...connection, status: "revoked", providerRevocation: "pending" }] });
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    let failure: unknown;
    await act(async () => { failure = await result.current.mutateAsync({ action: "start", provider: "google_drive" }).catch(error => error); });
    expect(failure).toMatchObject({ code: "REVOCATION_PENDING" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot refetch using a stale connection object after its cached generation was revoked", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.list(), { mode: "mock", connections: [{ ...connection, status: "revoked", generation: 2, providerRevocation: "revoked" }] });
    const { result } = renderHook(() => useIntegrationResources(connection), { wrapper });
    await act(async () => { await result.current.refetch(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("rejects live resources slipped into a mock response and erases its private cache", async () => {
    fetchMock.mockResolvedValue({ resources: [{ ...resource, sampleOnly: false }] });
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.resources(connection), { resources: [resource] });
    const { result } = renderHook(() => useIntegrationResources(connection), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
  });

  it("erases a rejected private result and cannot restore it after a later 503 or remount", async () => {
    fetchMock.mockResolvedValueOnce({ resources: [resource] })
      .mockRejectedValueOnce(new ApiError(403, "SOURCE_UNAVAILABLE", "denied"))
      .mockRejectedValue(new ApiError(503, "error", "offline"));
    const { client, wrapper } = setup();
    const view = renderHook(() => useIntegrationResources(connection), { wrapper });
    await waitFor(() => expect(view.result.current.data?.resources).toHaveLength(1));
    await act(async () => { await view.result.current.refetch(); });
    await waitFor(() => expect(view.result.current.data?.resources ?? []).toEqual([]));
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
    await act(async () => { await view.result.current.refetch(); });
    expect(view.result.current.data?.resources ?? []).toEqual([]);
    view.unmount();
    const remount = renderHook(() => useIntegrationResources(connection), { wrapper });
    await waitFor(() => expect(remount.result.current.isFetching).toBe(false));
    expect(remount.result.current.data?.resources ?? []).toEqual([]);
  });

  it("treats 404 as disabled and does not repeatedly refetch on remount", async () => {
    fetchMock.mockRejectedValue(new ApiError(404, "NOT_FOUND", "off"));
    const { client, wrapper } = setup(); client.removeQueries();
    const first = renderHook(() => useConnections(), { wrapper });
    await waitFor(() => expect(first.result.current.data?.mode).toBe("disabled"));
    first.unmount();
    const next = renderHook(() => useConnections(), { wrapper });
    expect(next.result.current.data?.mode).toBe("disabled");
    expect(next.result.current.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears private caches on list denial and does not resurrect them after a 503", async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "denied")).mockRejectedValue(new ApiError(503, "error", "offline"));
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.resources(connection), { resources: [resource] });
    const view = renderHook(() => useConnections(), { wrapper });
    await act(async () => { await view.result.current.refetch(); });
    await act(async () => { await view.result.current.refetch(); });
    await waitFor(() => expect(view.result.current.data?.connections ?? []).toEqual([]));
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
  });

  it("rejects a late sync result after revoke, clears sources immediately, and invalidates Studio", async () => {
    let finishSync!: (value: unknown) => void;
    const pendingSync = new Promise(resolve => { finishSync = resolve; });
    fetchMock.mockImplementation(async path => {
      if (path.endsWith("/sync")) return pendingSync;
      if (path.endsWith("/revoke")) return { local: "revoked", provider: "pending" };
      throw new Error(`Unexpected ${path}`);
    });
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.resources(connection), { resources: [resource] });
    client.setQueryData(["studio", "thread", "thread-1"], { saved: true });
    const { result } = renderHook(() => ({ sync: useIntegrationCommand(), revoke: useIntegrationCommand() }), { wrapper });
    let sync!: Promise<unknown>;
    act(() => { sync = result.current.sync.mutateAsync({ action: "sync", connectionId: connection.id, requestId: "sync-1" }).catch(error => error); });
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/sync"))).toBe(true));
    await act(async () => { await result.current.revoke.mutateAsync({ action: "revoke", connectionId: connection.id, requestId: "revoke-1" }); });
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
    await act(async () => { finishSync({ status: "completed", resources: [resource] }); });
    expect(await sync).toMatchObject({ code: "STALE_CONNECTION" });
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
    expect(client.getQueryState(["studio", "thread", "thread-1"])?.isInvalidated).toBe(true);
  });

  it("preserves independent import rights in the wire payload and refreshes the current Studio", async () => {
    fetchMock.mockResolvedValue({ sources: [] });
    const { client, wrapper } = setup();
    client.setQueryData(["studio", "thread", "thread-1"], { revision: 3 });
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ action: "import", connectionId: connection.id,
      input: { threadId: "thread-1", revision: 3, resourceIds: ["resource-1"], question: "Which hook?", modelConsent: false, processingRights: false, shareRights: false, requestId: "import-1" } }); });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/me/integrations/drive-1/import");
    expect(JSON.parse(init!.body as string)).toEqual({ threadId: "thread-1", revision: 3, resourceIds: ["resource-1"], question: "Which hook?", modelConsent: false, processingRights: false, shareRights: false, requestId: "import-1" });
    expect(client.getQueryState(["studio", "thread", "thread-1"])?.isInvalidated).toBe(true);
  });

  it("cannot start a provider when mock mode has not been enabled", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.list(), { mode: "disabled", connections: [] });
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    let failure: unknown;
    await act(async () => { failure = await result.current.mutateAsync({ action: "start", provider: "instagram" }).catch(error => error); });
    expect(failure).toMatchObject({ code: "INTEGRATIONS_DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("separates private cached data when the current creator changes in the same workspace", async () => {
    fetchMock.mockResolvedValueOnce({ mode: "mock", connections: [connection] }).mockResolvedValue({ mode: "mock", connections: [] });
    const { client, wrapper } = setup(); client.removeQueries();
    client.setQueryData(["me"], { id: "creator-a" });
    const view = renderHook(() => useConnections(), { wrapper });
    await waitFor(() => expect(view.result.current.data?.connections).toHaveLength(1));
    act(() => { client.setQueryData(["me"], { id: "creator-b" }); });
    await waitFor(() => expect(view.result.current.data?.connections ?? []).toEqual([]));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("erases cached resources on a server STALE_CONNECTION refusal", async () => {
    fetchMock.mockRejectedValue(new ApiError(409, "STALE_CONNECTION", "generation changed"));
    const { client, wrapper } = setup();
    client.setQueryData(integrationKeys.resources(connection), { resources: [resource] });
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ action: "sync", connectionId: connection.id, requestId: "sync-1" }).catch(() => {}); });
    expect(JSON.stringify(client.getQueryData(integrationKeys.resources(connection)))).not.toContain("PRIVATE");
  });

  it("refuses non-mock consent responses instead of opening a provider", async () => {
    fetchMock.mockResolvedValue({ state: "unsafe", expiresAt: "2099-01-01T00:00:00Z", provider: "instagram", scopes: [], sampleOnly: false, authorizationUrl: "https://example.invalid/oauth" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    let failure: unknown;
    await act(async () => { failure = await result.current.mutateAsync({ action: "start", provider: "instagram" }).catch(error => error); });
    expect(failure).toMatchObject({ code: "MOCK_ONLY" });
    expect(result.current.data).toBeUndefined();
  });

  it("does not request insight data after permissions are partial or revoked", async () => {
    const { client, wrapper } = setup();
    const partial = { ...connection, provider: "instagram" as const, status: "partial" as const, scopes: ["instagram_business_basic"] };
    renderHook(() => useIntegrationResources(partial), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => { client.setQueryData(integrationKeys.list(), { mode: "mock", connections: [{ ...connection, status: "revoked" }] }); });
    const { result } = renderHook(() => useIntegrationCommand(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ action: "sync", connectionId: connection.id, requestId: "no-sync" }).catch(() => {}); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
