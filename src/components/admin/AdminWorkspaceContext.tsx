import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const SS_KEY = "adfocate_admin_workspace";
const SS_SLUG_KEY = "adfocate_admin_workspace_slug";

type WorkspaceSelection = { workspace: string; workspaceSlug: string };

function initialWorkspace(): WorkspaceSelection {
  if (typeof window === "undefined") return { workspace: "", workspaceSlug: "" };
  const storedWorkspace = window.sessionStorage.getItem(SS_KEY) ?? "";
  const storedSlug = window.sessionStorage.getItem(SS_SLUG_KEY) ?? "";
  const fromUrl = new URLSearchParams(window.location.search).get("ws");
  if (fromUrl !== null) {
    return {
      workspace: fromUrl,
      workspaceSlug: fromUrl === storedWorkspace ? storedSlug : "",
    };
  }
  return { workspace: storedWorkspace, workspaceSlug: storedSlug };
}

type Ctx = {
  workspace: string;
  workspaceSlug: string;
  setWorkspace: (id: string, slug?: string) => void;
};
const AdminWorkspaceContext = createContext<Ctx | null>(null);

export function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<WorkspaceSelection>(initialWorkspace);

  const setWorkspace = useCallback((id: string, slug = "") => {
    setSelection({ workspace: id, workspaceSlug: slug });
    if (typeof window === "undefined") return;
    if (id) {
      window.sessionStorage.setItem(SS_KEY, id);
      if (slug) window.sessionStorage.setItem(SS_SLUG_KEY, slug);
      else window.sessionStorage.removeItem(SS_SLUG_KEY);
    } else {
      window.sessionStorage.removeItem(SS_KEY);
      window.sessionStorage.removeItem(SS_SLUG_KEY);
    }
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ws", id);
    else url.searchParams.delete("ws");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const value = useMemo(
    () => ({ ...selection, setWorkspace }),
    [selection, setWorkspace],
  );
  return <AdminWorkspaceContext.Provider value={value}>{children}</AdminWorkspaceContext.Provider>;
}

export function useAdminWorkspace(): Ctx {
  const ctx = useContext(AdminWorkspaceContext);
  if (!ctx) throw new Error("useAdminWorkspace must be used within AdminWorkspaceProvider");
  return ctx;
}
