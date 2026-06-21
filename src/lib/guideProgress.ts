const key = (creatorId: string) => `adfocate.guide.read.${creatorId}`;

/** Read-progress is per-creator (shared device safe) and client-only (MVP). */
export function getRead(creatorId: string | undefined | null): Set<string> {
  if (!creatorId) return new Set();
  try {
    const raw = localStorage.getItem(key(creatorId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markRead(creatorId: string | undefined | null, docId: string): void {
  if (!creatorId) return;
  const set = getRead(creatorId);
  set.add(docId);
  try {
    localStorage.setItem(key(creatorId), JSON.stringify([...set]));
  } catch {
    /* quota / unavailable — ignore */
  }
}
