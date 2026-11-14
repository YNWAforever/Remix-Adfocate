import type { SupabaseClient } from "@supabase/supabase-js";

/** Private in-memory actor. Never serialize this object or an SDK response. */
export interface ProviderActor {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly client: SupabaseClient;
  accessToken: string;
}
export interface ProviderCaseResult {
  readonly name: string;
  readonly status: "passed";
  readonly evidenceSha256: string;
  readonly actualHttpRequests: number;
}
/** Only the owned local runtime constructs this capability; import is inert. */
export interface ProviderRehearsalRuntime {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly apiOrigin: string;
  readonly appOrigin: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly otherWorkspaceId: string;
  readonly anonKey: string;
  readonly service: SupabaseClient;
  readonly anonymous: SupabaseClient;
  readonly actors: {
    readonly creator: ProviderActor;
    readonly otherCreator: ProviderActor;
    readonly operator: ProviderActor;
    readonly reviewer: ProviderActor;
    readonly staff: ProviderActor;
    readonly revoked: ProviderActor;
    readonly noMembership: ProviderActor;
  };
  readonly httpRequests: number;
  /** Re-inspects exact owned container/network/image/port identity, not a cached boolean. */
  assertOwned(): Promise<void>;
  /** Expiry-only negative: signed with the verified owned local provider key; explicitly not provider-issued. */
  expiredSignedAccessToken(actor: ProviderActor): Promise<string>;
  /** Exact local HTTP origin; no redirects, hosted targets or external provider calls. */
  request(actor: ProviderActor | null, path: string, init?: RequestInit): Promise<Response>;
  /** Trusted repository fixture SQL only; no CLI-supplied SQL or target override exists. */
  sql(fixedFixtureSql: string): Promise<readonly string[]>;
  /** Hash private facts and require new actual HTTP requests since the supplied checkpoint. */
  record(name: string, privateFacts: unknown, httpRequestsBefore: number): ProviderCaseResult;
}
export class ProviderRehearsalFailure extends Error {
  constructor(readonly code: string) { super("Provider rehearsal held"); this.name = "ProviderRehearsalFailure"; }
}
export function requireProviderFact(value: unknown, code: string): asserts value {
  if (!value) throw new ProviderRehearsalFailure(code);
}
