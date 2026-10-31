import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { ApiError, apiFetch, getWorkspaceSlug } from "@/lib/api";
import type { StudioSource } from "@/lib/studio/types";
import type { IntegrationConnection, IntegrationImport, IntegrationList, IntegrationResource, ProviderId, StartConnection } from "./types";

const root = () => ["integrations", getWorkspaceSlug()] as const;
export const integrationKeys = {
  all: ["integrations"] as const,
  list: (owner = "current") => [...root(), "list", owner] as const,
  resources: (connection: Pick<IntegrationConnection, "id" | "generation">, owner = "current") => [...root(), "resources", connection.id, connection.generation, owner] as const,
  picker: (connection: Pick<IntegrationConnection, "id" | "generation">, owner = "current") => [...root(), "picker", connection.id, connection.generation, owner] as const,
};
export type PickerFile = { id: string; title: string; mimeType: string; rights: IntegrationResource["rights"]; canDownload: boolean };
type PickerResult = { files: PickerFile[]; sampleOnly: true };
export type IntegrationCommand =
  | { action: "start"; provider: ProviderId }
  | { action: "complete"; provider: ProviderId; state: string; code: "allow" | "partial" | "deny" }
  | { action: "sync" | "revoke" | "purge"; connectionId: string; requestId: string }
  | { action: "resources"; connectionId: string; requestId: string; fileIds: string[] }
  | { action: "import"; connectionId: string; input: IntegrationImport };
export type IntegrationCommandResult = StartConnection | { connection: IntegrationConnection }
  | { resources: IntegrationResource[]; status?: "completed" | "partial" | "rate_limited" }
  | { sources: StudioSource[] } | { local: "revoked"; provider: "revoked" | "pending" | "manual_action" }
  | { state: "complete" | "pending" };

// A lifecycle change fences *all* in-flight private responses in this client.
// Server generation checks remain authoritative; this prevents stale UI resurrection.
const epochs = new WeakMap<QueryClient, number>();
const epoch = (client: QueryClient) => epochs.get(client) ?? 0;
const fence = (client: QueryClient) => epochs.set(client, epoch(client) + 1);
class LocalStaleResponse extends ApiError {
  constructor() { super(409, "STALE_CONNECTION", "Connection changed"); }
}
const stale = () => new LocalStaleResponse();
const currentOwner = (client: QueryClient) => client.getQueryData<{ id: string }>(["me"])?.id ?? "current";
function useOwnerId() {
  // Observe the existing authenticated profile without issuing another request.
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(event => {
    if (event.query.queryKey.length === 1 && event.query.queryKey[0] === "me") notify();
  }), [client]);
  return useSyncExternalStore(subscribe, () => currentOwner(client), () => currentOwner(client));
}
const featureOff = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.code === "INTEGRATIONS_DISABLED");
const refreshStudio = (client: QueryClient) => client.invalidateQueries({ queryKey: ["studio"] });

function clearPrivate(client: QueryClient, id?: string, except?: readonly unknown[], owner = currentOwner(client)) {
  fence(client);
  for (const query of client.getQueryCache().findAll({ queryKey: root() })) {
    const key = query.queryKey;
    if ((key[2] !== "resources" && key[2] !== "picker") || (id && key[3] !== id) || key.at(-1) !== owner) continue;
    if (JSON.stringify(key) !== JSON.stringify(except)) void client.cancelQueries({ queryKey: key, exact: true });
    client.setQueryData(key, key[2] === "picker" ? { files: [], sampleOnly: true } : { resources: [] });
  }
}

export function canReadConnection(connection?: IntegrationConnection) {
  const required = connection?.provider === "instagram"
    ? ["instagram_business_basic", "instagram_business_manage_insights"]
    : ["https://www.googleapis.com/auth/drive.file"];
  return Boolean(connection?.sampleOnly && (connection.status === "connected" || connection.status === "partial")
    && Date.parse(connection.expiresAt) > Date.now() && required.every(scope => connection.scopes.includes(scope)));
}

export function useConnections() {
  const client = useQueryClient();
  const owner = useOwnerId(), workspace = getWorkspaceSlug();
  const key = integrationKeys.list(owner);
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<IntegrationList> => {
      const started = epoch(client);
      let result: IntegrationList;
      try {
        result = await apiFetch<IntegrationList>("/me/integrations", { signal });
      } catch (error) {
        if (started !== epoch(client) || currentOwner(client) !== owner || getWorkspaceSlug() !== workspace) throw stale();
        clearPrivate(client, undefined, undefined, owner);
        client.setQueryData(key, { mode: "disabled", connections: [] });
        if (featureOff(error)) return { mode: "disabled", connections: [] };
        throw error;
      }
      if (started !== epoch(client) || currentOwner(client) !== owner || getWorkspaceSlug() !== workspace) throw stale();
      // This UI never enables a real provider, even if a server is misconfigured.
      if (result.mode !== "mock") {
        clearPrivate(client);
        return { mode: "disabled", connections: result.connections.filter(item => item.sampleOnly === true) };
      }
      return { mode: "mock", connections: result.connections.filter(item => item.sampleOnly === true) };
    },
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    staleTime: query => query.state.data?.mode === "disabled" ? Infinity : 30_000,
  });
  return { ...query, data: query.isError ? undefined : query.data };
}

function usePrivateQuery<T>(connection: IntegrationConnection | undefined, kind: "resources" | "picker", enabled: boolean) {
  const client = useQueryClient();
  const owner = useOwnerId(), workspace = getWorkspaceSlug();
  const key = integrationKeys[kind](connection ?? { id: "none", generation: 0 }, owner);
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(enabled && canReadConnection(connection)),
    queryFn: async ({ signal }): Promise<T> => {
      const started = epoch(client);
      let result: T;
      try {
        result = await apiFetch<T>(`/me/integrations/${encodeURIComponent(connection!.id)}/${kind}`, { signal });
        if (kind === "picker" && (result as PickerResult).sampleOnly !== true) throw new ApiError(403, "MOCK_ONLY", "Mock only");
      } catch (error) {
        if (started !== epoch(client) || currentOwner(client) !== owner || getWorkspaceSlug() !== workspace) throw stale();
        clearPrivate(client, connection!.id, key, owner);
        void refreshStudio(client);
        throw error;
      }
      if (started !== epoch(client) || currentOwner(client) !== owner || getWorkspaceSlug() !== workspace) throw stale();
      return result;
    },
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    staleTime: 0,
  });
  return { ...query, data: query.isError || !canReadConnection(connection) || !enabled ? undefined : query.data };
}

export const useIntegrationResources = (connection?: IntegrationConnection, enabled = true) => usePrivateQuery<{ resources: IntegrationResource[] }>(connection, "resources", enabled);
export const useDrivePicker = (connection: IntegrationConnection, enabled = true) => usePrivateQuery<PickerResult>(connection, "picker", enabled);

export function useIntegrationCommand() {
  const client = useQueryClient();
  const owner = useOwnerId(), workspace = getWorkspaceSlug();
  const listKey = integrationKeys.list(owner);
  return useMutation({
    retry: false,
    onMutate: async (command: IntegrationCommand) => {
      if (command.action !== "revoke" && command.action !== "purge") return;
      if (owner !== currentOwner(client) || workspace !== getWorkspaceSlug()) throw stale();
      clearPrivate(client, command.connectionId, undefined, owner);
      await client.cancelQueries({ queryKey: listKey, exact: true });
      client.setQueryData<IntegrationList>(listKey, previous => previous && ({ ...previous,
        connections: previous.connections.map(connection => connection.id === command.connectionId
          ? { ...connection, status: "revoked", generation: connection.generation + 1, providerRevocation: "pending" } : connection),
      }));
      void refreshStudio(client);
    },
    mutationFn: async (command: IntegrationCommand): Promise<IntegrationCommandResult> => {
      const lifecycle = command.action === "revoke" || command.action === "purge";
      if (owner !== currentOwner(client) || workspace !== getWorkspaceSlug()) throw stale();
      if (!lifecycle && client.getQueryData<IntegrationList>(listKey)?.mode !== "mock") {
        throw new ApiError(404, "INTEGRATIONS_DISABLED", "Mock connections unavailable");
      }
      if (!lifecycle && "connectionId" in command && !canReadConnection(client.getQueryData<IntegrationList>(listKey)?.connections.find(item => item.id === command.connectionId))) {
        throw new ApiError(403, "SOURCE_UNAVAILABLE", "Connection access unavailable");
      }
      const started = epoch(client);
      const id = "connectionId" in command ? command.connectionId : command.provider;
      const body = command.action === "start" ? { returnPath: "/connections" }
        : command.action === "complete" ? { state: command.state, code: command.code }
        : command.action === "import" ? command.input
        : command.action === "resources" ? { requestId: command.requestId, fileIds: command.fileIds }
        : { requestId: command.requestId };
      const result = await apiFetch<IntegrationCommandResult>(`/me/integrations/${encodeURIComponent(id)}/${command.action}`, { method: "POST", body: JSON.stringify(body) });
      if (started !== epoch(client) || owner !== currentOwner(client) || workspace !== getWorkspaceSlug()) throw stale();
      if (command.action === "start" && (!("sampleOnly" in result) || result.sampleOnly !== true)) throw new ApiError(403, "MOCK_ONLY", "Mock only");
      if ("connection" in result && result.connection.sampleOnly !== true) throw new ApiError(403, "MOCK_ONLY", "Mock only");
      return result;
    },
    onSuccess: async (result, command) => {
      if ("connection" in result) {
        client.setQueryData<IntegrationList>(listKey, previous => ({ mode: "mock", connections: [
          ...(previous?.connections.filter(item => item.provider !== result.connection.provider) ?? []), result.connection,
        ] }));
      }
      if ("local" in result && "connectionId" in command) {
        client.setQueryData<IntegrationList>(listKey, previous => previous && ({ ...previous,
          connections: previous.connections.map(item => item.id === command.connectionId ? { ...item, status: "revoked", providerRevocation: result.provider } : item),
        }));
      }
      if (command.action === "start") return;
      if (command.action === "import" || command.action === "revoke" || command.action === "purge") await refreshStudio(client);
      await client.invalidateQueries({ queryKey: listKey });
      if (command.action === "sync" || command.action === "resources") {
        await client.invalidateQueries({ queryKey: [...root(), "resources", command.connectionId] });
      }
    },
    onError: (error, command) => {
      if (error instanceof LocalStaleResponse || owner !== currentOwner(client) || workspace !== getWorkspaceSlug()) return;
      if ("connectionId" in command) {
        clearPrivate(client, command.connectionId, undefined, owner);
        void refreshStudio(client);
      }
      if (error instanceof ApiError && error.code === "INTEGRATIONS_DISABLED") {
        client.setQueryData<IntegrationList>(listKey, previous => ({ mode: "disabled", connections: previous?.connections ?? [] }));
      }
    },
  });
}
