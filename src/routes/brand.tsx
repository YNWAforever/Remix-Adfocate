import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { BrandAuthGate } from "@/components/brand/BrandAuthGate";
import { BrandAuthContext } from "@/components/brand/BrandAuthContext";
import { BrandNav } from "@/components/brand/BrandNav";

export const Route = createFileRoute("/brand")({ component: BrandLayout });

function BrandLayout() {
  const [, setAuthError] = useState<unknown>(null);
  return (
    <BrandAuthGate>
      {(brand) => (
        <BrandAuthContext.Provider value={{ brand, reportAuthError: setAuthError }}>
          <div className="min-h-screen bg-[var(--color-paper)] lg:pl-60">
            <BrandNav />
            <main className="mx-auto max-w-5xl space-y-4 p-4 pb-24 lg:pb-4">
              <Outlet />
            </main>
          </div>
        </BrandAuthContext.Provider>
      )}
    </BrandAuthGate>
  );
}
