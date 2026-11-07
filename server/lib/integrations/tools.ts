import { IntegrationError } from "./policy.js";
import type { IntegrationService } from "./service.js";
import type { Actor } from "./types.js";

/** Narrow, server-bound read tools. They are not a public MCP server or OAuth endpoint. */
export function createIntegrationTools(service: IntegrationService, actor: Actor, selectedThreadSourceIds: string[]) {
  const selected = new Set(selectedThreadSourceIds);
  return { async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "listConnections") {
      if (Object.keys(args).length) throw new IntegrationError("INVALID_TOOL_ARGUMENTS");
      return (await service.list(actor)).map(row => ({ id: row.id, provider: row.provider, status: row.status, sampleOnly: row.sampleOnly }));
    }
    if (!["readInstagramInsights", "readSelectedDriveSource"].includes(name) || Object.keys(args).some(key => key !== "sourceId") || typeof args.sourceId !== "string" || !selected.has(args.sourceId)) throw new IntegrationError("TOOL_NOT_ALLOWED", 403);
    const source = await service.readSelectedSource(actor, args.sourceId);
    if (source.integration?.provenance !== (name === "readInstagramInsights" ? "instagram" : "google_drive")) throw new IntegrationError("TOOL_NOT_ALLOWED", 403);
    return { title: source.title, content: source.content, question: source.question, observedAt: source.observed_at, platform: source.platform, coverage: source.integration.coverage, sampleOnly: true, verification: "unverified" };
  } };
}
