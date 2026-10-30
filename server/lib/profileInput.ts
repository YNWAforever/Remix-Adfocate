// Bounds for creator-editable profile fields. These values are shown to operators, brands
// and (masked) on public passports, so unbounded or wrongly-typed input is refused up front.

export const PROFILE_LIMITS = { displayName: 60, categories: 20, category: 40, handles: 10, handle: 100, url: 2048 } as const;

const len = (s: string) => [...s].length; // code points, so Chinese text counts per character

export function profileInputError(body: Record<string, unknown>): string | null {
  const { display_name, categories, social_handles, avatar_url } = body;
  if (display_name !== undefined && display_name !== null
    && (typeof display_name !== "string" || len(display_name) > PROFILE_LIMITS.displayName)) return "display_name";
  if (categories !== undefined && categories !== null
    && (!Array.isArray(categories) || categories.length > PROFILE_LIMITS.categories
      || categories.some((c) => typeof c !== "string" || len(c) > PROFILE_LIMITS.category))) return "categories";
  if (social_handles !== undefined && social_handles !== null
    && (!Array.isArray(social_handles) || social_handles.length > PROFILE_LIMITS.handles
      || social_handles.some((h) => !h || typeof h !== "object" || JSON.stringify(h).length > 4 * PROFILE_LIMITS.handle))) return "social_handles";
  if (avatar_url !== undefined && avatar_url !== null
    && (typeof avatar_url !== "string" || avatar_url.length > PROFILE_LIMITS.url || !/^https?:\/\//i.test(avatar_url))) return "avatar_url";
  return null;
}
