import { useEffect } from "react";
import { STUDIO_SHELL } from "@/lib/features";
import "./studio-journeys.css";

/** Root scope also themes portalled controls and standalone auth/passport pages. */
export function StudioTheme() {
  useEffect(() => {
    if (!STUDIO_SHELL) return;
    const root = document.documentElement;
    const previous = root.dataset.studioTheme;
    root.dataset.studioTheme = "on";
    return () => {
      if (previous === undefined) delete root.dataset.studioTheme;
      else root.dataset.studioTheme = previous;
    };
  }, []);
  return null;
}
