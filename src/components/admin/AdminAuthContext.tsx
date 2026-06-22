import { createContext, useContext } from "react";

export type AdminStaff = { userId: string | null; email: string };

export type AdminAuth = {
  authed: boolean;
  staff: AdminStaff | null;
  reportAuthError: (error: unknown) => void;
};

export const AdminAuthContext = createContext<AdminAuth>({
  authed: false,
  staff: null,
  reportAuthError: () => {},
});

export function useAdminAuth(): AdminAuth {
  return useContext(AdminAuthContext);
}
