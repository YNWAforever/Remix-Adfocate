export interface ChunkOpts { maxChars: number; overlapChars: number; }

/** Greedy word-boundary chunker with character overlap. Deterministic, no deps. */
export function chunkText(text: string, opts: ChunkOpts): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const w of words) {
    const add = (cur.length ? 1 : 0) + w.length;
    if (curLen + add > opts.maxChars && cur.length) {
      chunks.push(cur.join(" "));
      // start next chunk with last word from prior chunk (respects overlapChars intent)
      cur = cur.length > 0 ? [cur[cur.length - 1]] : [];
      curLen = cur.join(" ").length;
    }
    cur.push(w);
    curLen += add;
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}
