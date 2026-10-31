/** Development-only adapter. The actual mock service runs in memory, without HTTP providers. */
import { CredentialVault } from "../../server/lib/integrations/credentials";
import { MemoryIntegrationRepository } from "../../server/lib/integrations/memoryRepo";
import { createMockProviders } from "../../server/lib/integrations/mockProviders";
import { IntegrationError } from "../../server/lib/integrations/policy";
import { IntegrationService } from "../../server/lib/integrations/service";
import type { Actor, IntegrationRecord, ProviderId } from "../../server/lib/integrations/types";
import type { IntegrationImport } from "../lib/integrations/types";
import type { StudioDetail, StudioSection } from "../lib/studio/types";
import { redactRevokedIntegrationOutputs } from "../lib/studio/policy";

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
export function createIntegrationPreview(actor: Actor, threads: () => StudioDetail[], clearReceipts: () => void) {
  const thread = (id: unknown) => {
    const detail = threads().find(value => value.thread.id === id);
    if (!detail) throw new IntegrationError("NOT_FOUND", 404);
    return detail;
  };
  const repo = new MemoryIntegrationRepository(() => new Date(), {
    importSources: (_, payload, sources) => {
      const detail = thread(payload.threadId);
      if (detail.thread.revision !== payload.revision) throw new IntegrationError("WORKFLOW_STALE", 409);
      const fresh = sources.filter(source => !detail.sources.some(existing => existing.id === source.id));
      if (detail.sources.length + fresh.length > 100) throw new IntegrationError("SOURCE_LIMIT", 409);
      detail.sources.push(...structuredClone(fresh)); detail.thread.revision++;
    },
    revokeSources: (_, ids) => {
      for (const detail of threads()) {
        let changed = false;
        for (const source of detail.sources) if (ids.includes(source.id) && !source.revoked_at) {
          source.revoked_at = new Date().toISOString(); source.shareable = false;
          if (source.integration) { source.integration.model_allowed = false; source.integration.availability = "revoked"; }
          changed = true;
        }
        if (changed) { detail.thread.revision++; detail.messages = redactRevokedIntegrationOutputs(detail).messages; }
      }
      clearReceipts();
    },
    purgeSources: (_, ids) => {
      for (const detail of threads()) {
        const affected = detail.sources.some(source => ids.includes(source.id));
        detail.sources = detail.sources.filter(source => !ids.includes(source.id));
        for (const brief of detail.briefs) brief.sections = brief.sections.filter(section => !section.sourceIds.some(id => ids.includes(id)));
        if (affected) detail.messages = detail.messages.filter(message => message.role === "user");
      }
      clearReceipts();
    },
  });
  const service = new IntegrationService(repo, createMockProviders(), new CredentialVault(crypto.getRandomValues(new Uint8Array(32)), "local-preview-only"));
  return {
    async handle(path: string, method: string, body: IntegrationRecord): Promise<Response | null> {
      if (!path.startsWith("/me/integrations")) return null;
      try {
        const parts = path.slice("/me/integrations".length).split("/").filter(Boolean), [id, action] = parts;
        if (!parts.length && method === "GET") return response({ mode: "mock", connections: await service.list(actor) });
        if (["instagram", "google_drive"].includes(id) && action === "start" && method === "POST") return response(await service.beginConnection(actor, id as ProviderId, "local-preview-session", String(body.returnPath ?? "/connections")));
        if (["instagram", "google_drive"].includes(id) && action === "complete" && method === "POST") return response({ connection: await service.completeConnection(actor, id as ProviderId, "local-preview-session", String(body.code), String(body.state)) });
        if (action === "resources" && method === "GET") return response({ resources: await service.resources(actor, id) });
        if (action === "picker" && method === "GET") return response(await service.picker(actor, id));
        if (method !== "POST") throw new IntegrationError("NOT_FOUND", 404);
        if (action === "sync") return response(await service.syncConnection(actor, id, String(body.requestId)));
        if (action === "resources") return response(await service.registerSelectedFiles(actor, id, body.fileIds as string[], String(body.requestId)));
        if (action === "import") return response(await service.importSources(actor, id, body as unknown as IntegrationImport));
        if (action === "revoke") return response(await service.revokeConnection(actor, id, String(body.requestId)));
        if (action === "purge") return response(await service.purgeConnection(actor, id, String(body.requestId)));
        throw new IntegrationError("NOT_FOUND", 404);
      } catch (error) {
        return response({ code: error instanceof IntegrationError ? error.code : "LOCAL_INTEGRATION_UNAVAILABLE" }, error instanceof IntegrationError ? error.status : 503);
      }
    },
    async authorizeCommand(action: string, payload: IntegrationRecord) {
      if (action !== "save_brief" && action !== "share_brief") return;
      const detail = thread(payload.threadId);
      let sections = payload.sections as StudioSection[];
      if (action === "share_brief") {
        const brief = detail.briefs.find(value => value.id === payload.briefId);
        if (!brief) throw new IntegrationError("NOT_FOUND", 404);
        sections = brief.sections.filter(section => (payload.sectionIds as string[]).includes(section.id));
      }
      const ids = [...new Set(sections.flatMap(section => section.sourceIds))];
      if (ids.some(id => !detail.sources.some(source => source.id === id && !source.revoked_at))) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
      const integrated = ids.filter(id => detail.sources.find(source => source.id === id)?.integration);
      const use = action === "save_brief" ? "save_brief" : "share";
      await service.authorizeSources(actor, integrated, use, payload);
      repo.consumePermits(actor, integrated, use, payload);
    },
    async modelSources(detail: StudioDetail, requestId: string) {
      const sources = detail.sources.filter(source => !source.revoked_at && source.integration?.model_allowed);
      await service.authorizeSources(actor, sources.map(source => source.id), "model", { requestId });
      repo.consumePermits(actor, sources.map(source => source.id), "model", { requestId });
      return structuredClone(sources);
    },
    revokeSource(id: string) { repo.revokeSource(actor, id); clearReceipts(); },
  };
}
