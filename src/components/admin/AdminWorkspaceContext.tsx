import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const SS_KEY = "adfocate_admin_workspace";

function initialWorkspace(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("ws");
  if (fromUrl !== null) return fromUrl;
  return window.sessionStorage.getItem(SS_KEY) ?? "";
}

type Ctx = { workspace: string; setWorkspace: (id: string) => void };
const AdminWorkspaceContext = createContext<Ctx | null>(null);

export function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<string>(initialWorkspace);

  const setWorkspace = useCallback((id: string) => {
    setWorkspaceState(id);
    if (typeof window === "undefined") return;
    if (id) window.sessionStorage.setItem(SS_KEY, id);
    else window.sessionStorage.removeItem(SS_KEY);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ws", id);
    else url.searchParams.delete("ws");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const value = useMemo(() => ({ workspace, setWorkspace }), [workspace, setWorkspace]);
  return <AdminWorkspaceContext.Provider value={value}>{children}</AdminWorkspaceContext.Provider>;
}

export function useAdminWorkspace(): Ctx {
  const ctx = useContext(AdminWorkspaceContext);
  if (!ctx) throw new Error("useAdminWorkspace must be used within AdminWorkspaceProvider");
  return ctx;
}
