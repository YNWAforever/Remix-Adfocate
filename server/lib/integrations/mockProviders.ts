import { IntegrationError, requiredScopes } from "./policy.js";
import { normalizeInstagramMedia } from "./instagram.js";
import type { Actor, IntegrationProvider, ProviderFile, ProviderGrant, ProviderId } from "./types.js";

/** No HTTP client exists in this adapter. Only explicitly labelled local examples. */
export function createMockProviders(): Record<ProviderId, IntegrationProvider> {
  function provider(id: ProviderId): IntegrationProvider {
    const files: ProviderFile[] = [
      { externalId: "mock-owned-brief", title: "茶日和拍攝筆記（示例）", mimeType: "application/vnd.google-apps.document", version: "example-v1", sizeBytes: 148, canDownload: true, rights: "owned", content: "【合成文件】觀眾想知道一人份量與真實口感。先展示茶杯及包裝，再描述試飲感受。清楚標示合作關係；不要把示例數字當真實成效。" },
      { externalId: "mock-private-research", title: "只供閱讀的訪問摘要（示例）", mimeType: "text/plain", version: "example-v1", sizeBytes: 90, canDownload: true, rights: "unknown", content: "【合成私人資料】這份摘要的轉分享權未確認，不應送到任務審核或外部模型。" },
      { externalId: "mock-shot-list", title: "拍攝清單 PDF（文字示例）", mimeType: "application/pdf", version: "example-v1", sizeBytes: 85, canDownload: true, rights: "owned", content: "【PDF 摘錄示例；未解析真實 PDF】近鏡、自然光、真實體驗、合作揭露。" },
    ];
    return {
      id, mode: "mock",
      async authorize(code: string, actor: Actor, now: Date): Promise<ProviderGrant> {
        if (code === "deny") throw new IntegrationError("AUTHORIZATION_DECLINED", 403);
        if (!["allow", "partial"].includes(code)) throw new IntegrationError("INVALID_INPUT");
        return { subject: `example-${id}-${actor.creatorId}`, label: id === "instagram" ? "@leaf_creator（模擬帳號）" : "creator@example.test（模擬帳號）",
          scopes: code === "partial" ? requiredScopes(id).slice(0, -1) : requiredScopes(id), accessToken: `mock-access-${crypto.randomUUID()}`, refreshToken: `mock-refresh-${crypto.randomUUID()}`, expiresAt: new Date(now.getTime() + 3600000).toISOString() };
      },
      async refresh(grant, now) { return { ...grant, accessToken: `mock-access-${crypto.randomUUID()}`, expiresAt: new Date(now.getTime() + 3600000).toISOString() }; },
      async revoke() { /* Simulated provider revocation; no external side effect. */ },
      async read(_connection, _grant, now, signal) {
        if (signal.aborted) throw new IntegrationError("STALE_CONNECTION", 409);
        if (id !== "instagram") return [];
        return Promise.all([
          normalizeInstagramMedia({ id: "mock-ig-tea", title: "一杯茶的日常故事", version: "example-v1", observedAt: new Date(now.getTime() - 86400000).toISOString(), metrics: { reach: 1280, views: 1640, likes: 86, saves: 0 } }, now),
          normalizeInstagramMedia({ id: "mock-ig-new", title: "新作品，還在累積觀察", version: "example-v1", observedAt: now.toISOString(), metrics: {} }, now),
        ]);
      },
      async files() { return id === "google_drive" ? structuredClone(files) : []; },
      async file(_connection, _grant, externalId) { const file = files.find(file => file.externalId === externalId); if (id !== "google_drive" || !file) throw new IntegrationError("SOURCE_UNAVAILABLE", 403); return structuredClone(file); },
    };
  }
  return { instagram: provider("instagram"), google_drive: provider("google_drive") };
}
