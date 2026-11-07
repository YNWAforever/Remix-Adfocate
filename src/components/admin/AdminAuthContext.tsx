import { createContext, useContext } from "react";

export type AdminStaff = { userId: string | null; email: string };

export type AdminAuth = {
  authed: boolean;
  staff: AdminStaff | null;
  signOut: () => Promise<void>;
  reportAuthError: (error: unknown) => void;
};

export const AdminAuthContext = createContext<AdminAuth>({
  authed: false,
  staff: null,
  signOut: async () => {},
  reportAuthError: () => {},
});

export function useAdminAuth(): AdminAuth {
  return useContext(AdminAuthContext);
}
