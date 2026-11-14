import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { digestDeltaProofPayload } from "./delta-evidence";
import { ProviderRehearsalFailure, requireProviderFact as check, type ProviderActor, type ProviderCaseResult, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { installProviderNetworkGuard } from "./delta-provider-network";
import type { OwnedProviderStack } from "./delta-provider-stack";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function providerCaseReceipt(name: string, facts: unknown, before: number, after: number, binding: { runId: string; sourceCommit: string; targetBindingHash: string }): ProviderCaseResult {
  check(/^[a-z0-9][a-z0-9.-]{1,100}$/.test(name) && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= 0 && after > before, "actual-http-evidence-required");
  return { name, status: "passed", actualHttpRequests: after - before, evidenceSha256: digestDeltaProofPayload({ ...binding, name, privateFacts: facts }) };
}
export async function createProviderRuntime(stack: OwnedProviderStack, sourceCommit: string): Promise<ProviderRehearsalRuntime & { close(): Promise<void>; externalRequestsBlocked(): number }> {
  check(/^[a-f0-9]{40}$/.test(sourceCommit) && UUID.test(stack.runId), "runtime-source-binding"); await stack.assertOwned();
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID(), workspaceSlug = `provider-${stack.runId}`;
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address(); check(address && typeof address === "object", "local-app-listener");
  const appOrigin = `http://127.0.0.1:${address.port}`, network = installProviderNetworkGuard([stack.apiOrigin, appOrigin]);
  let requests = 0, closing = false;
  const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  // Original routes/SDKs may log private database errors. Dedicated runner emits only its closed receipts.
  for (const name of Object.keys(originalConsole) as (keyof typeof originalConsole)[]) console[name] = () => undefined;
  const clients: SupabaseClient[] = [];
  async function close() {
    if (closing) return; closing = true;
    let failed = false;
    for (const client of clients) {
      try { await client.auth.stopAutoRefresh(); } catch { failed = true; }
      try { await client.removeAllChannels(); } catch { failed = true; }
    }
    try {
      await new Promise<void>((ok, fail) => {
        const timer = setTimeout(() => { server.closeAllConnections(); fail(new ProviderRehearsalFailure("app-close-unverified")); }, 5_000);
        server.close(error => { clearTimeout(timer); if (error) fail(new ProviderRehearsalFailure("app-close-unverified")); else ok(); });
        server.closeAllConnections();
      });
    } catch { failed = true; }
    finally {
      try { network.close(); } catch { failed = true; }
      for (const name of Object.keys(originalConsole) as (keyof typeof originalConsole)[]) console[name] = originalConsole[name];
    }
    if (failed) throw new ProviderRehearsalFailure("app-close-unverified");
  }
  try {
    const guardedFetch: typeof fetch = async (input, init) => {
      check(!closing, "runtime-closed"); await stack.assertOwned();
      const response = await network.fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000), redirect: "error" }); requests++;
      return response;
    };
    // The actual application imports global fetch and environment at module evaluation time.
    globalThis.fetch = guardedFetch;
    Object.assign(process.env, { SUPABASE_URL: stack.apiOrigin, SUPABASE_ANON_KEY: stack.anonKey, SUPABASE_SERVICE_KEY: stack.serviceKey,
      VERCEL_GIT_COMMIT_SHA: sourceCommit, STAFF_MFA_REQUIRED: "true", STAFF_EMAIL_ALLOWLIST: "", STAFF_EMAIL_DOMAINS: "owned-provider.invalid", ADMIN_SECRET: "",
      BOOTSTRAP_WORKSPACE_SLUGS: workspaceSlug, OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", RAPIDAPI_KEY: "" });
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
    function client(key: string, suffix: string) {
      const value = createClient(stack.apiOrigin, key, { ...options, auth: { ...options.auth, storageKey: `provider-${stack.runId}-${suffix}` } }); clients.push(value); return value;
    }
    const service = client(stack.serviceKey, "service"), anonymous = client(stack.anonKey, "anonymous");
    const inserted = await service.from("workspaces").insert([{ id: workspaceId, slug: workspaceSlug, name: "Owned provider rehearsal" }, { id: otherWorkspaceId, slug: `${workspaceSlug}-denied`, name: "Owned denial scope" }]);
    check(!inserted.error, "workspace-fixture-created");
    async function actor(name: string, kind: "creator" | "staff" | "no-membership"): Promise<ProviderActor> {
      const email = `${name}-${stack.runId}@example.test`, password = `Owned-${randomBytes(32).toString("base64url")}aA1!`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      check(!created.error && created.data.user && /^[a-f0-9-]{36}$/.test(created.data.user.id), "auth-fixture-created");
      const id = created.data.user.id;
      if (kind === "creator") {
        check(!(await service.from("creators").insert({ id, workspace_id: workspaceId, display_name: `Owned ${name}`, xp: 0, onboarding_completed: true })).error, "creator-fixture-created");
        check(!(await service.from("point_balances").insert({ creator_id: id, workspace_id: workspaceId, balance: 50 })).error, "point-fixture-created");
        check(!(await service.from("earnings_balances").insert({ creator_id: id, workspace_id: workspaceId, available: 0 })).error, "cash-fixture-created");
      } else {
        check(!(await service.from("staff_users").insert({ user_id: id, email, active: true })).error, "staff-fixture-created");
        if (kind === "staff") check(!(await service.from("brand_users").insert({ user_id: id, email, workspace_id: workspaceId, active: true, role: "member" })).error, "staff-membership-created");
      }
      const sdk = client(stack.anonKey, name), signed = await sdk.auth.signInWithPassword({ email, password });
      check(!signed.error && signed.data.session?.access_token && signed.data.user?.id === id, "provider-session-created");
      return { id, email, password, client: sdk, accessToken: signed.data.session.access_token };
    }
    const actors = { creator: await actor("creator", "creator"), otherCreator: await actor("other-owner", "creator"),
      operator: await actor("operator", "staff"), reviewer: await actor("reviewer", "staff"), staff: await actor("staff", "staff"),
      revoked: await actor("revoked", "creator"), noMembership: await actor("no-membership", "no-membership") };
    for (const [selected, role] of [[actors.staff, "workspace_admin"], [actors.operator, "operator"], [actors.reviewer, "reviewer"]] as const) {
      check(UUID.test(workspaceId) && /^[a-f0-9-]{36}$/.test(selected.id) && /^[a-f0-9-]{36}$/.test(actors.staff.id), "staff-fixture-identifiers");
      await stack.sql(`select private.bootstrap_staff_access('${actors.staff.id}','${workspaceId}','${selected.id}','${role}',true,0,'${randomUUID()}','Owned local provider fixture','owned-provider-${stack.runId}');`);
    }
    // Real application, with DNS/HTTP/socket egress constrained before this import; no route mocks.
    const { createApp } = await import("../../server/app"); const { app } = createApp();
    server.on("request", async (incoming, outgoing) => {
      try {
        check(incoming.headers.host === new URL(appOrigin).host, "app-authority");
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of incoming) { const bytes = Buffer.from(chunk); size += bytes.length; check(size <= 64 * 1024, "app-body-limit"); chunks.push(bytes); }
        const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const body = Buffer.concat(chunks), method = incoming.method ?? "GET";
        const request = new Request(new URL(incoming.url ?? "/", appOrigin), { method, headers, ...(!["GET", "HEAD"].includes(method) ? { body } : {}) });
        const response = await app.fetch(request); outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(Buffer.from(await response.arrayBuffer())); body.fill(0); for (const bytes of chunks) bytes.fill(0);
      } catch { if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"code":"owned_http_refusal"}'); }
    });
    const targetBindingHash = digestDeltaProofPayload({ projectId: stack.projectId, apiOrigin: stack.apiOrigin, appOrigin, identities: stack.identities.map(row => ({ id: row.id, image: row.image })) });
    const runtime: ProviderRehearsalRuntime & { close(): Promise<void>; externalRequestsBlocked(): number } = {
      runId: stack.runId, sourceCommit, apiOrigin: stack.apiOrigin, appOrigin, workspaceId, workspaceSlug, otherWorkspaceId,
      anonKey: stack.anonKey, service, anonymous, actors, get httpRequests() { return requests; }, assertOwned: stack.assertOwned, sql: stack.sql, close, externalRequestsBlocked: network.blockedRequests,
      async request(selected, path, init = {}) {
        check(/^\/api\/[a-zA-Z0-9/?=&%_.-]+$/.test(path) && !path.includes("..") && !path.includes("//"), "fixed-app-route");
        const headers = new Headers(init.headers); if (selected) headers.set("Authorization", `Bearer ${selected.accessToken}`);
        if (!headers.has("X-Workspace-Slug")) headers.set("X-Workspace-Slug", workspaceSlug); if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        headers.set("Origin", appOrigin); return guardedFetch(new URL(path, appOrigin), { ...init, headers });
      },
      async expiredSignedAccessToken(selected) {
        await stack.assertOwned(); const canonicalActor = Object.values(actors).find(value => value.id === selected.id);
        check(canonicalActor && selected === canonicalActor && stack.jwtSecret.length >= 32, "owned-expired-signer");
        const verified = await canonicalActor.client.auth.getUser(canonicalActor.accessToken); check(!verified.error && verified.data.user?.id === canonicalActor.id, "owned-expiry-session-prerequisite");
        const parts = selected.accessToken.split("."); check(parts.length === 3, "owned-expired-signing-input");
        const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
        check(payload.sub === selected.id && payload.iss === `${stack.apiOrigin}/auth/v1` && typeof payload.session_id === "string", "owned-expired-session-binding");
        const now = Math.floor(Date.now() / 1000), header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
        function sign(exp: number) { const body = Buffer.from(JSON.stringify({ ...payload, iat: now - 3600, exp })).toString("base64url"), input = `${header}.${body}`; return `${input}.${createHmac("sha256", stack.jwtSecret).update(input).digest("base64url")}`; }
        const freshTwin = await selected.client.auth.getUser(sign(now + 300)); check(!freshTwin.error && freshTwin.data.user?.id === selected.id, "owned-expiry-key-not-verified");
        return sign(now - 60);
      },
      record(name, facts, before) { return providerCaseReceipt(name, facts, before, requests, { runId: stack.runId, sourceCommit, targetBindingHash }); },
    };
    return runtime;
  } catch (error) { await close(); throw error; }
}
