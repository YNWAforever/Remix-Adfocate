import { createContext, useContext } from "react";
import type { BrandMe } from "@/lib/brand";

export type BrandAuth = { brand: BrandMe; reportAuthError: (e: unknown) => void };
export const BrandAuthContext = createContext<BrandAuth | null>(null);
export function useBrandAuth(): BrandAuth {
  const ctx = useContext(BrandAuthContext);
  if (!ctx) throw new Error("useBrandAuth must be used within BrandAuthGate");
  return ctx;
}
