/** One unacknowledged redemption per tab, owner, workspace and gift. */
export type RedemptionIntent = { key: string; requestId: string };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export class RedemptionIntentError extends Error {
  readonly code = "redemption_intent_unavailable";
  constructor() { super("Unable to preserve the redemption intent"); }
}

export function getRedemptionIntent(owner: string, workspace: string, gift: string): RedemptionIntent {
  try {
    const storage = window.sessionStorage;
    const key = `adfocate:redemption-intent:v1:${JSON.stringify([owner, workspace, gift])}`;
    const previous = storage.getItem(key);
    if (previous !== null) {
      const requestId: unknown = JSON.parse(previous).requestId;
      if (typeof requestId !== "string" || !uuid.test(requestId)) throw new RedemptionIntentError();
      return { key, requestId };
    }
    const requestId = crypto.randomUUID();
    const value = JSON.stringify({ requestId });
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw new RedemptionIntentError();
    return { key, requestId };
  } catch { throw new RedemptionIntentError(); }
}

export function acknowledgeRedemptionIntent(intent: RedemptionIntent): void {
  try {
    const storage = window.sessionStorage;
    const current = storage.getItem(intent.key);
    if (current !== null && JSON.parse(current).requestId === intent.requestId) storage.removeItem(intent.key);
  } catch { throw new RedemptionIntentError(); }
}
