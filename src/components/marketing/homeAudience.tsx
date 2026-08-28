import { createContext, useContext, useState, type ReactNode } from "react";
import type { Audience } from "./AudienceToggle";

export type { Audience };

type HomeAudienceValue = {
  audience: Audience;
  setAudience: (next: Audience) => void;
};

const HomeAudienceContext = createContext<HomeAudienceValue | null>(null);

/**
 * Shares the homepage creator/brand selection between the sticky MarketingHeader
 * (which hosts the toggle + section nav on "/") and the homepage sections. Wraps
 * the whole _site layout so the header and the page render in lock-step.
 */
export function HomeAudienceProvider({ children }: { children: ReactNode }) {
  const [audience, setAudience] = useState<Audience>("creator");
  return (
    <HomeAudienceContext.Provider value={{ audience, setAudience }}>
      {children}
    </HomeAudienceContext.Provider>
  );
}

export function useHomeAudience(): HomeAudienceValue {
  const value = useContext(HomeAudienceContext);
  // Fallback to component-local state when no provider is present (e.g. a unit
  // test rendering the header or the page in isolation). In the real app the
  // provider wraps the whole _site layout, so header and page share one state.
  const [localAudience, setLocalAudience] = useState<Audience>("creator");
  return value ?? { audience: localAudience, setAudience: setLocalAudience };
}
