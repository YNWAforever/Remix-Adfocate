import type { PGlite } from "@electric-sql/pglite";
import { CredentialVault } from "../../lib/integrations/credentials.js";
import { createMockProviders } from "../../lib/integrations/mockProviders.js";
import { databaseFailure } from "../../lib/integrations/repo.js";
import { IntegrationService } from "../../lib/integrations/service.js";
import type { Actor, ConnectionRecord, IntegrationRecord, IntegrationRepository, ResourceRecord } from "../../lib/integrations/types.js";

/** Local transport adapter only: real service, real SQL, actual encryption, mock
 * providers. Does not instantiate Supabase or accept any URL/environment client. */
class PGliteIntegrationRepository implements IntegrationRepository {
  constructor(private db: PGlite) {}
  async list(actor: Actor): Promise<ConnectionRecord[]> {
    const result = await this.db.query<{ data: ConnectionRecord }>("select data from public.integration_connections where workspace_id=$1 and creator_id=$2 order by id", [actor.workspaceId, actor.creatorId]);
    return result.rows.map(row => row.data);
  }
  async connection(actor: Actor, id: string): Promise<ConnectionRecord | null> {
    const result = await this.db.query<{ data: ConnectionRecord }>("select data from public.integration_connections where workspace_id=$1 and creator_id=$2 and id=$3", [actor.workspaceId, actor.creatorId, id]);
    return result.rows[0]?.data ?? null;
  }
  async resources(actor: Actor, id: string): Promise<ResourceRecord[]> {
    const result = await this.db.query<{ data: ResourceRecord }>(`select r.data from public.integration_resources r
      join public.integration_connections c on c.id=r.connection_id and c.generation=r.generation
      where r.workspace_id=$1 and r.creator_id=$2 and r.connection_id=$3 order by r.id`, [actor.workspaceId, actor.creatorId, id]);
    return result.rows.map(row => row.data);
  }
  async resourceIdentities(actor: Actor, id: string, externalIds: string[]): Promise<Array<Pick<ResourceRecord, "id" | "externalId">>> {
    return (await this.db.query<{ id: string; externalId: string }>(`select id,data->>'externalId' as "externalId" from public.integration_resources
      where workspace_id=$1 and creator_id=$2 and connection_id=$3 and data->>'externalId'=any($4::text[])`, [actor.workspaceId, actor.creatorId, id, externalIds])).rows;
  }
  async command(actor: Actor, requestId: string, action: string, payload: IntegrationRecord): Promise<IntegrationRecord> {
    try {
      const result = await this.db.query<{ result: IntegrationRecord }>("select public.integration_command($1,$2,$3,$4,$5::jsonb) result", [actor.workspaceId, actor.creatorId, requestId, action, JSON.stringify(payload)]);
      return result.rows[0].result;
    } catch (error) { return databaseFailure({ message: (error as Error).message }); }
  }
}

export function integrationServiceFixture(db: PGlite) {
  const repo = new PGliteIntegrationRepository(db), providers = createMockProviders();
  const service = new IntegrationService(repo, providers, new CredentialVault(new Uint8Array(32).fill(19), "sql-smoke-fixture-key"));
  return { service, repo, providers };
}
