import { describe, expect, it, vi } from "vitest";

const importMocks = vi.hoisted(() => {
  const spawn = vi.fn();
  const spawnSync = vi.fn(() => ({ status: 0 }));
  const processRef = {
    argv: ["node", "vitest-entry.mjs"],
    cwd: () => "C:/repo",
    env: {},
    execPath: "node",
    exit: vi.fn(),
    kill: vi.fn(),
    pid: 10,
    stderr: { write: vi.fn() },
  };
  return { processRef, spawn, spawnSync };
});

vi.mock("node:child_process", () => ({
  default: { spawn: importMocks.spawn, spawnSync: importMocks.spawnSync },
  spawn: importMocks.spawn,
  spawnSync: importMocks.spawnSync,
}));
vi.mock("node:process", () => ({ default: importMocks.processRef }));

// @ts-expect-error -- the executable .mjs launcher intentionally has no declaration file.
const runner = await import("../../scripts/run-integration-tests.mjs");

const expectedIntegrationFiles = [
  "server/test/rls.test.ts",
  "server/test/bootstrap.test.ts",
  "server/test/onboarding.test.ts",
  "server/test/missions.test.ts",
  "server/test/admin.test.ts",
  "server/test/admin-staff.test.ts",
  "server/test/redemption.test.ts",
  "server/test/wallet.test.ts",
  "server/test/me.test.ts",
  "server/test/leveling.test.ts",
  "server/test/passport.test.ts",
  "server/test/match.test.ts",
  "server/test/copilot.test.ts",
  "server/test/applications.test.ts",
  "server/test/social-schema.test.ts",
  "server/test/social.test.ts",
  "server/test/verificationGate.test.ts",
  "server/test/public-passport.test.ts",
  "server/test/cron-social-refresh.test.ts",
  "server/test/operator-crm-schema.test.ts",
  "server/test/operator-crm.test.ts",
  "server/test/assistant.test.ts",
  "server/test/adminContent.test.ts",
  "server/test/content.test.ts",
  "server/test/active-mission-schema.test.ts",
  "server/test/active-missions.test.ts",
  "server/test/reward-contracts.test.ts",
  "server/test/reward-handoffs.test.ts",
  "server/test/notifications-triggers.test.ts",
  "server/test/notifications-api.test.ts",
  "server/test/insights.test.ts",
  "server/test/radar.test.ts",
  "server/test/brand.test.ts",
  "server/test/campaigns.test.ts",
  "server/test/campaigns-s2.test.ts",
  "server/test/brandResources.test.ts",
  "server/test/academy.test.ts",
  "server/test/adminAcademy.test.ts",
  "server/test/academy-seed.test.ts",
  "server/test/publication-proof-review-live.test.ts",
];

function harness() {
  importMocks.spawnSync.mockClear();
  const childHandlers = new Map();
  const signalHandlers = new Map();
  const child = {
    killed: false,
    kill: vi.fn(),
    once: vi.fn((event, handler) => {
      childHandlers.set(event, handler);
      return child;
    }),
  };
  const processRef = {
    argv: ["node", "test"],
    cwd: () => "C:/repo",
    env: {
      PRESERVE_ME: "yes",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_KEY: "service-key",
      SUPABASE_ANON_KEY: "anon-key",
          INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify({ disposable: true, ownerAuthorization: "synthetic-owner-approval", projectId: "synthetic-project", runId: "synthetic-run", proxy: "none", apiContainerId: "a".repeat(64), databaseContainerId: "b".repeat(64), networkId: "synthetic-network", apiImageId: "sha256:synthetic-api", databaseImageId: "sha256:synthetic-db", apiPort: 54321 }),
    },
    execPath: "C:/node/node.exe",
    exit: vi.fn(),
    kill: vi.fn(),
    on: vi.fn((signal, handler) => signalHandlers.set(signal, handler)),
    pid: 42,
    removeListener: vi.fn((signal) => signalHandlers.delete(signal)),
    stderr: { write: vi.fn() },
  };
  const spawnImpl = vi.fn(() => child);
  return { child, childHandlers, processRef, signalHandlers, spawnImpl };
}

describe("integration test launcher", () => {
  it.each([
    [{}, "SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_ANON_KEY are required"],
    [{ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_KEY: "service", SUPABASE_ANON_KEY: "anon" }, "loopback"],
  ])("fails closed before preflight for an unusable integration environment", (env, message) => {
    const h = harness();
    h.processRef.env = env as typeof h.processRef.env;
    importMocks.spawnSync.mockClear();

    expect(() => runner.launchIntegrationTests({ processRef: h.processRef, spawnImpl: h.spawnImpl, verifyIdentityImpl: () => {} }))
      .toThrow(message);
    expect(importMocks.spawnSync).not.toHaveBeenCalled();
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });
  it("keeps the complete ordered integration file list unique", () => {
    expect(runner.publicationProofPreflightFile).toBe("server/test/publication-proof-asset-grant-live.test.ts");
    expect(runner.integrationFiles).toEqual(expectedIntegrationFiles);
    expect(new Set(runner.integrationFiles).size).toBe(expectedIntegrationFiles.length);
    const activeMissionsIndex = runner.integrationFiles.indexOf("server/test/active-missions.test.ts");
    expect(runner.integrationFiles.slice(activeMissionsIndex + 1, activeMissionsIndex + 3)).toEqual([
      "server/test/reward-contracts.test.ts",
      "server/test/reward-handoffs.test.ts",
    ]);
    expect(runner.integrationFiles.filter((file: string) => file === "server/test/reward-contracts.test.ts")).toHaveLength(1);
    expect(runner.integrationFiles.filter((file: string) => file === "server/test/reward-handoffs.test.ts")).toHaveLength(1);
  });

  it("arms capability fixtures only for the verified local Supabase project", () => {
    expect(runner.localSupabaseProjectId()).toBe("adfocate-2");
    const local = harness();
    const identity = JSON.parse(local.processRef.env.INTEGRATION_TARGET_IDENTITY_JSON as string);
    identity.projectId = "adfocate-2";
    local.processRef.env.INTEGRATION_TARGET_IDENTITY_JSON = JSON.stringify(identity);
    runner.launchIntegrationTests({
      processRef: local.processRef,
      spawnImpl: local.spawnImpl,
      verifyIdentityImpl: () => identity,
    });
    const withFixtures = expect.objectContaining({
      env: expect.objectContaining({ INTEGRATION_CAPABILITY_FIXTURES: "1" }),
    });
    expect(importMocks.spawnSync).toHaveBeenCalledWith(expect.any(String), expect.any(Array), withFixtures);
    expect(local.spawnImpl).toHaveBeenCalledWith(expect.any(String), expect.any(Array), withFixtures);

    const other = harness();
    runner.launchIntegrationTests({
      processRef: other.processRef,
      spawnImpl: other.spawnImpl,
      verifyIdentityImpl: () => ({ projectId: "synthetic-project" }),
    });
    expect(other.spawnImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ env: expect.not.objectContaining({ INTEGRATION_CAPABILITY_FIXTURES: expect.anything() }) }),
    );
  });

  it("spawns local Vitest with the exact environment and preserves numeric exit codes", () => {
    const h = harness();
    runner.launchIntegrationTests({ processRef: h.processRef, spawnImpl: h.spawnImpl, verifyIdentityImpl: () => {} });

    expect(importMocks.spawnSync).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/), "run", "--no-file-parallelism", "server/test/publication-proof-asset-grant-live.test.ts"],
      {
        cwd: "C:/repo",
        env: {
          PRESERVE_ME: "yes",
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_KEY: "service-key",
          SUPABASE_ANON_KEY: "anon-key",
          INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify({ disposable: true, ownerAuthorization: "synthetic-owner-approval", projectId: "synthetic-project", runId: "synthetic-run", proxy: "none", apiContainerId: "a".repeat(64), databaseContainerId: "b".repeat(64), networkId: "synthetic-network", apiImageId: "sha256:synthetic-api", databaseImageId: "sha256:synthetic-db", apiPort: 54321 }),
          RUN_INTEGRATION: "1",
          INTEGRATION_RUNNER: "1",
        },
        stdio: "inherit",
      },
    );
    expect(h.spawnImpl).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/), "run", "--no-file-parallelism", ...expectedIntegrationFiles],
      {
        cwd: "C:/repo",
        env: {
          PRESERVE_ME: "yes",
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_KEY: "service-key",
          SUPABASE_ANON_KEY: "anon-key",
          INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify({ disposable: true, ownerAuthorization: "synthetic-owner-approval", projectId: "synthetic-project", runId: "synthetic-run", proxy: "none", apiContainerId: "a".repeat(64), databaseContainerId: "b".repeat(64), networkId: "synthetic-network", apiImageId: "sha256:synthetic-api", databaseImageId: "sha256:synthetic-db", apiPort: 54321 }),
          RUN_INTEGRATION: "1",
          INTEGRATION_RUNNER: "1",
        },
        stdio: "inherit",
      },
    );
    h.childHandlers.get("exit")(7, null);
    expect(h.processRef.exit).toHaveBeenCalledWith(7);
  });

  it.each(["SIGINT", "SIGTERM"])("forwards and re-emits %s without orphaning the child", (signal) => {
    const h = harness();
    runner.launchIntegrationTests({ processRef: h.processRef, spawnImpl: h.spawnImpl, verifyIdentityImpl: () => {} });

    h.signalHandlers.get(signal)();
    expect(h.child.kill).toHaveBeenCalledWith(signal);
    h.childHandlers.get("exit")(null, signal);
    expect(h.processRef.kill).toHaveBeenCalledWith(42, signal);
    expect(h.processRef.exit).not.toHaveBeenCalled();
    expect(h.processRef.removeListener).toHaveBeenCalledTimes(2);
  });
});

function pristineHarness() {
 const runId='11111111-1111-4111-8111-111111111111', projectId='adfocate-d19-pristine-20261024-unit';
 const identity={disposable:true,ownerAuthorization:'explicit new disposable target authorization',projectId,runId,proxy:'none',apiContainerId:'a'.repeat(64),databaseContainerId:'b'.repeat(64),networkId:'c'.repeat(64),apiImageId:'sha256:api',databaseImageId:'sha256:db',apiPort:56631};
 const created='2026-10-24T09:00:00Z',volume=projectId+'-db-data';
 const receipt={identity,createdThisRun:true,volumeWasAbsent:true,networkWasAbsent:true,databaseCreatedAt:created,volumeName:volume,volumeCreatedAt:created,containerIds:[identity.apiContainerId,identity.databaseContainerId],pristineBaseline:{campaigns:0,authUsers:0},ownerAuthorization:identity.ownerAuthorization};
 const env={SUPABASE_URL:'http://127.0.0.1:56631',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_KEY:'synthetic-service',INTEGRATION_TARGET_IDENTITY_JSON:JSON.stringify(identity),INTEGRATION_PRISTINE_TARGET_JSON:JSON.stringify(receipt)};
 const network={id:identity.networkId,internal:true,labels:{'adfocate.run':runId,'adfocate.pristine':'true'},containers:[...receipt.containerIds]};
 const volumeInfo={name:volume,created,labels:{'adfocate.run':runId,'adfocate.pristine':'true'}};
 const rows:string[]=[];
 const inspect=vi.fn((_command:string,args:string[])=>{
  let value:unknown;
  if(args[0]==='context')return {status:0,stdout:'npipe:////./pipe/dockerDesktopLinuxEngine'};
  if(args[0]==='network')value=network;
  else if(args[0]==='volume')value=volumeInfo;
  else if(args[0]==='exec')return {status:0,stdout:JSON.stringify(rows)};
  else {const db=args.at(-1)===identity.databaseContainerId;value={id:db?identity.databaseContainerId:identity.apiContainerId,image:db?identity.databaseImageId:identity.apiImageId,running:true,project:projectId,created,mounts:db?[{Type:'volume',Name:volume,Destination:'/var/lib/postgresql/data',RW:true}]:[],ports:db?{}:{'8000/tcp':[{HostIp:'127.0.0.1',HostPort:'56631'}]},networks:{pristine:{NetworkID:identity.networkId}}};}
  return {status:0,stdout:JSON.stringify(value)};
 });
 return {identity,receipt,env,network,volumeInfo,rows,inspect};
}
describe('new pristine global campaign job identity',()=>{
 it('accepts the exact newly-created volume, exclusive internal network and owned campaign inventory',()=>{
  const h=pristineHarness(),id='22222222-2222-4222-8222-222222222222';h.rows.push(id);
  expect(runner.verifyIntegrationIdentity(h.env,h.inspect,[id])).toEqual(h.identity);
  expect(h.inspect.mock.calls.some(([,args])=>args[0]==='exec')).toBe(true);
 });
 it.each(['old-project','baseline-data','volume-reused','network-shared','external-network','wrong-volume','wrong-owner'])('rejects %s evidence before any SQL or client setup',kind=>{
  const h=pristineHarness();
  if(kind==='old-project'){h.receipt.identity.projectId='adfocate-r1-shaped-20261023';h.env.INTEGRATION_TARGET_IDENTITY_JSON=JSON.stringify(h.receipt.identity);}
  if(kind==='baseline-data')h.receipt.pristineBaseline.campaigns=1;
  if(kind==='volume-reused')h.receipt.volumeWasAbsent=false;
  if(kind==='network-shared')h.network.containers.push('d'.repeat(64));
  if(kind==='external-network')h.network.internal=false;
  if(kind==='wrong-volume')h.volumeInfo.name='old-retained-volume';
  if(kind==='wrong-owner')h.network.labels['adfocate.run']='other-run';
  h.env.INTEGRATION_PRISTINE_TARGET_JSON=JSON.stringify(h.receipt);
  expect(()=>runner.verifyIntegrationIdentity(h.env,h.inspect,[])).toThrow(/pristine/i);
  expect(h.inspect.mock.calls.some(([,args])=>args[0]==='exec')).toBe(false);
 });
 it('rejects a campaign not captured by this run before the global mutation',()=>{
  const h=pristineHarness();h.rows.push('33333333-3333-4333-8333-333333333333');
  expect(()=>runner.verifyIntegrationIdentity(h.env,h.inspect,[])).toThrow(/campaign.*owned/i);
 });
 it('refuses nonlocal Docker engine endpoints',()=>{
  const h=pristineHarness(),inspect=(c:string,a:string[])=>a[0]==='context'?{status:0,stdout:'tcp://elsewhere:2375'}:h.inspect(c,a);
  expect(()=>runner.verifyIntegrationIdentity(h.env,inspect,[])).toThrow(/pristine/i);
 });
 it('accepts a dedicated loopback bridge with masquerading disabled when Docker cannot publish an internal-network port',()=>{
  const h=pristineHarness();
  const receipt={...h.receipt,isolationMode:'dedicated-bridge-no-masquerade'};
  h.env.INTEGRATION_PRISTINE_TARGET_JSON=JSON.stringify(receipt);
  const network={...h.network,internal:false,options:{'com.docker.network.bridge.enable_ip_masquerade':'false','com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'}};
  const inspect=(c:string,a:string[])=>a[0]==='network'?{status:0,stdout:JSON.stringify(network)}:h.inspect(c,a);
  expect(runner.verifyIntegrationIdentity(h.env,inspect,[])).toEqual(h.identity);
 });
 it('rejects a bridge claim whose actual masquerading remains enabled',()=>{
  const h=pristineHarness();h.env.INTEGRATION_PRISTINE_TARGET_JSON=JSON.stringify({...h.receipt,isolationMode:'dedicated-bridge-no-masquerade'});
  const network={...h.network,internal:false,options:{'com.docker.network.bridge.enable_ip_masquerade':'true','com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'}};
  const inspect=(c:string,a:string[])=>a[0]==='network'?{status:0,stdout:JSON.stringify(network)}:h.inspect(c,a);
  expect(()=>runner.verifyIntegrationIdentity(h.env,inspect,[])).toThrow(/pristine/i);
 });
});

function localGrantHarness(projectId = "adfocate-2", existingRole = "", failSql = false) {
  const networkId = "c".repeat(64);
  const api = {
    id: "a".repeat(64), image: "sha256:synthetic-api", running: true, project: projectId,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    networks: { ci: { NetworkID: networkId } }, mounts: [],
  };
  const database = {
    ...api, id: "b".repeat(64), image: "sha256:synthetic-db", ports: {},
    networks: { ci: { NetworkID: networkId } },
  };
  const identity = {
    disposable: true,
    ownerAuthorization: "GitHub Actions YNWAforever/Remix-Adfocate/actions/runs/40755337706/attempts/2: disposable integration job",
    runId: "40755337706-2", projectId, proxy: "none", apiPort: 54321,
    apiContainerId: api.id, databaseContainerId: database.id,
    apiImageId: api.image, databaseImageId: database.image, networkId,
  };
  const env: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_KEY: "synthetic-service", INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity),
  };
  const queries: string[] = [];
  const inspect = vi.fn((_command: string, args: string[], options?: { input?: string }) => {
    if (args[0] === "exec") {
      queries.push(String(options?.input ?? ""));
      if (failSql) return { status: 1, stdout: "", stderr: "STAFF_TARGET_NOT_ELIGIBLE\n" };
      if (String(options?.input ?? "").startsWith("select role")) return { status: 0, stdout: existingRole ? `${existingRole}\n` : "\n" };
      return { status: 0, stdout: "{}\n" };
    }
    return { status: 0, stdout: JSON.stringify(args.at(-1) === api.id ? api : database) };
  });
  return { api, database, env, identity, inspect, queries };
}

const grantUser = "11111111-1111-4111-8111-111111111111";
const grantWorkspace = "00000000-0000-0000-0000-0000000000aa";

describe("verified local fixture staff grants", () => {
  it("bootstraps a workspace role only on the verified database container", () => {
    const h = localGrantHarness();
    expect(runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "workspace_admin" }, h.inspect)).toBe("granted");
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0]).toContain("staff_workspace_roles");
    expect(h.queries[1]).toContain("private.bootstrap_staff_access");
    expect(h.queries[1]).toContain("'workspace_admin'");
    expect(h.queries[1]).toContain(`'${grantWorkspace}'`);
    expect(h.queries.join("\n")).not.toContain("synthetic-service");
    const execs = h.inspect.mock.calls.filter(([, args]) => args[0] === "exec");
    expect(execs).toHaveLength(2);
    expect(execs.every(([, args]) => args[2] === h.database.id && !args.includes("supabase_db_adfocate-2"))).toBe(true);
  });

  it("bootstraps a platform content editor with a null workspace", () => {
    const h = localGrantHarness();
    expect(runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: null, role: "content_editor" }, h.inspect)).toBe("granted");
    expect(h.queries[0]).toContain("staff_platform_roles");
    expect(h.queries[1]).toContain(",null,");
    expect(h.queries[1]).toContain("'content_editor'");
  });

  it("does not rewrite an identical active grant", () => {
    const h = localGrantHarness("adfocate-2", "operator");
    expect(runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toBe("exists");
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).not.toContain("bootstrap_staff_access");
  });

  it("refuses to promote an existing fixture role", () => {
    const h = localGrantHarness("adfocate-2", "reviewer");
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/no implicit promotion/);
    expect(h.queries).toHaveLength(1);
  });

  it.each(["other-local", "adfocate-r1-empty-20261023"])("refuses %s before SQL", (projectId) => {
    const h = localGrantHarness(projectId);
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/Unapproved fixture project/);
    expect(h.queries).toEqual([]);
  });

  it("refuses the retired shaped target before SQL", () => {
    const h = localGrantHarness("adfocate-r1-shaped-20261023");
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/retired|forensics/);
    expect(h.queries).toEqual([]);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("refuses identity drift before SQL", () => {
    const h = localGrantHarness();
    h.api.image = "sha256:replacement";
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/identity mismatch/);
    expect(h.queries).toEqual([]);
  });

  it("refuses a pristine receipt before SQL", () => {
    const h = localGrantHarness();
    h.env.INTEGRATION_PRISTINE_TARGET_JSON = "{}";
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/pristine/i);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("does not exec when the fixture id is not exact", () => {
    const h = localGrantHarness();
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: "not-a-uuid", workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/Invalid exact fixture grant/);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("surfaces a database failure without a second statement", () => {
    const h = localGrantHarness("adfocate-2", "", true);
    expect(() => runner.bootstrapVerifiedLocalStaffGrant(h.env, { userId: grantUser, workspaceId: grantWorkspace, role: "operator" }, h.inspect)).toThrow(/STAFF_TARGET_NOT_ELIGIBLE/);
    expect(h.queries).toHaveLength(1);
  });
});
