// PostgREST caps each response at `max_rows` (1000) and carries `.in(...)` filters in the URL,
// so unbounded admin lists must be read in pages and id lookups must be batched.

export const PAGE_SIZE = 1000;
/** Hard ceiling for "load the whole queue" reads; beyond this a list must paginate in the UI. */
export const MAX_ROWS = 20_000;
/** ~100 UUIDs keep an `in.(...)` filter well under common 8 KB URL limits. */
export const ID_BATCH = 100;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Read every row of an ordered query in PAGE_SIZE ranges (order must be deterministic). */
export async function fetchAllPages<T>(page: (from: number, to: number) => Page<T>): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return { data: rows, error: null };
  }
  return { data: [], error: { message: "list_too_large" } };
}

export function chunk<T>(items: readonly T[], size = ID_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
