import { createContext, useContext } from "react";

export type AdminAuth = {
  secret: string | null;
  reportAuthError: (error: unknown) => void;
};

export const AdminAuthContext = createContext<AdminAuth>({
  secret: null,
  reportAuthError: () => {},
});

export function useAdminAuth(): AdminAuth {
  return useContext(AdminAuthContext);
}
