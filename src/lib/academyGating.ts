import { levelIndex } from "./levels";

/** A track is unlocked when the creator's EFFECTIVE level reaches its requiredLevel.
 *  requiredLevel must be a canonical LEVELS id (not a display range like "L2+"). */
export function isTrackUnlocked(requiredLevel: string, effectiveLevel: string | undefined | null): boolean {
  return levelIndex(effectiveLevel ?? "L0") >= levelIndex(requiredLevel);
}
