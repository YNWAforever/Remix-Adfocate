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
