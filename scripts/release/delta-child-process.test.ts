// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedDeltaCommand, deltaChildEnvironment, deltaLocalDockerEndpoint, runDeltaCommand, runDeltaPrivateInput } from "./delta-child-process";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: boundary.spawn }));
const PRIVATE = "fixture-private-process-value-never-report";
class Child extends EventEmitter {
  readonly stdout = new PassThrough(); readonly stderr = new PassThrough();
  readonly inputCopies: Buffer[] = []; readonly inputReferences: Buffer[] = [];
  constructor(private readonly acknowledgeWrite = true) { super(); }
  readonly stdin = new Writable({ write: (chunk: Buffer, _encoding, done) => {
    this.inputCopies.push(Buffer.from(chunk)); this.inputReferences.push(chunk); if (this.acknowledgeWrite) done();
  } });
  readonly kill = vi.fn(() => false); readonly unref = vi.fn();
}
beforeEach(() => { boundary.spawn.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
async function safeFailure(promise: Promise<unknown>, text: string) {
  const error = await promise.then(() => undefined, error => error as Error);
  expect(error).toBeInstanceOf(Error); expect(error!.message).toContain(text);
  expect(`${error!.message}\n${error!.stack}`).not.toContain(PRIVATE); expect(error).not.toHaveProperty("cause");
}
function child(acknowledgeWrite = true) { const value = new Child(acknowledgeWrite); boundary.spawn.mockReturnValue(value); return value; }

describe("release child environment and fixed local Docker policy", () => {
  it("copies only host settings and never reads credential-value or Docker-routing getters", () => {
    const forbiddenRead = vi.fn(() => { throw new Error("private value must never be read"); });
    const env: NodeJS.ProcessEnv = { PATH: "/synthetic/bin", HOME: "/synthetic/home", SystemRoot: "C:\\Windows", LANG: "C.UTF-8" };
    for (const key of ["PGPASSWORD", "RELEASE_DATABASE_URL", "GITHUB_TOKEN", "VERCEL_TOKEN", "SUPABASE_ACCESS_TOKEN", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_AUTH_CONFIG"])
      Object.defineProperty(env, key, { enumerable: true, get: forbiddenRead });
    const output = deltaChildEnvironment(env);
    expect(output).toEqual({ PATH: "/synthetic/bin", HOME: "/synthetic/home", SystemRoot: "C:\\Windows", LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0" });
    expect(forbiddenRead).not.toHaveBeenCalled(); expect(Object.isFrozen(output)).toBe(true);
    env.PATH = "/changed"; expect(output.PATH).toBe("/synthetic/bin");
  });
  it("pins the verified local engine endpoint and refuses unsupported platforms", () => {
    expect(deltaLocalDockerEndpoint("win32")).toBe("npipe:////./pipe/dockerDesktopLinuxEngine");
    expect(deltaLocalDockerEndpoint("linux")).toBe("unix:///var/run/docker.sock"); expect(() => deltaLocalDockerEndpoint("darwin")).toThrow("unsupported");
    expect(boundary.spawn).not.toHaveBeenCalled();
  });
});

describe("bounded process transport (synthetic child only)", () => {
  it("uses pipe-only stdio and no shell while returning a bounded successful result", async () => {
    const c = child(), env = deltaChildEnvironment({ PATH: "/synthetic/bin", GITHUB_TOKEN: PRIVATE });
    const pending = runDeltaCommand("git", ["status", "--porcelain"], { cwd: "/synthetic/repo", env });
    c.stdout.write("synthetic-output"); c.emit("close", 0);
    expect(await pending).toEqual({ code: 0, stdout: "synthetic-output", stderr: "" });
    expect(boundary.spawn).toHaveBeenCalledWith("git", ["status", "--porcelain"], { cwd: "/synthetic/repo", env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  });
  it("consumes and clears the caller buffer immediately and its private copy after acknowledged write", async () => {
    const c = child(), input = Buffer.from(`${PRIVATE}\n`);
    const pending = boundedDeltaCommand("synthetic", [], { input, env: {} });
    expect(input.every(byte => byte === 0)).toBe(true); expect(c.inputCopies.map(value => value.toString())).toEqual([`${PRIVATE}\n`]);
    c.emit("close", 0); await pending; expect(c.inputReferences[0]!.every(byte => byte === 0)).toBe(true);
    expect(JSON.stringify(boundary.spawn.mock.calls)).not.toContain(PRIVATE);
  });
  it("settles on deadline with no child-close or kill acknowledgement and clears an unacknowledged stdin copy", async () => {
    vi.useFakeTimers(); const c = child(false), input = Buffer.from(PRIVATE);
    const result = safeFailure(boundedDeltaCommand("synthetic", [], { input, env: {}, timeoutMs: 25 }), "deadline exceeded");
    await vi.advanceTimersByTimeAsync(26); await result;
    expect(input.every(byte => byte === 0)).toBe(true); expect(c.inputReferences[0]!.every(byte => byte === 0)).toBe(true);
    expect(c.kill).toHaveBeenCalledWith("SIGKILL"); expect(c.unref).toHaveBeenCalledOnce();
    expect(c.stdout.destroyed).toBe(true); expect(c.stderr.destroyed).toBe(true);
  });
  it.each(["stdout", "stderr", "stdin"] as const)("redacts private %s stream errors and does not wait for close", async stream => {
    const c = child(false), pending = safeFailure(boundedDeltaCommand("synthetic", [], { input: Buffer.from(PRIVATE), env: {} }), `${stream} failed`);
    c[stream].emit("error", new Error(PRIVATE)); await pending; expect(c.inputReferences[0]!.every(byte => byte === 0)).toBe(true);
  });
  it("redacts spawn throws and child error events without retaining a cause", async () => {
    boundary.spawn.mockImplementationOnce(() => { throw new Error(PRIVATE); }); const input = Buffer.from(PRIVATE);
    await safeFailure(boundedDeltaCommand("synthetic", [], { input, env: {} }), "unavailable"); expect(input.every(byte => byte === 0)).toBe(true);
    const c = child(), pending = safeFailure(boundedDeltaCommand("synthetic", [], { env: {} }), "unavailable"); c.emit("error", new Error(PRIVATE)); await pending;
  });
  it("bounds stdout and stderr independently, including a child that never closes", async () => {
    const output = child(), first = safeFailure(boundedDeltaCommand("synthetic", [], { maximumOutputBytes: 10, env: {} }), "output bound exceeded");
    output.stdout.write(Buffer.alloc(11)); await first;
    const errors = child(), second = safeFailure(boundedDeltaCommand("synthetic", [], { env: {} }), "error-output bound exceeded");
    errors.stderr.write(Buffer.alloc(64 * 1024 + 1)); await second;
  });
  it("enforces the eight-megabyte default stdout limit", async () => {
    const c = child(), result = safeFailure(boundedDeltaCommand("synthetic", [], { env: {} }), "output bound exceeded");
    c.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1)); await result;
  });
  it.each([{ timeoutMs: 0 }, { timeoutMs: 1.1 }, { timeoutMs: Number.NaN }, { timeoutMs: 60001 }, { maximumOutputBytes: 0 }, { maximumOutputBytes: 33 * 1024 * 1024 }])("rejects invalid limits before spawning", async options => {
    await safeFailure(boundedDeltaCommand("synthetic", [], options), "limits invalid"); expect(boundary.spawn).not.toHaveBeenCalled();
  });
  it("clears a supplied credential buffer even when limit validation fails", async () => {
    const input = Buffer.from(PRIVATE); await safeFailure(boundedDeltaCommand("synthetic", [], { input, timeoutMs: 0 }), "limits invalid");
    expect(input.every(byte => byte === 0)).toBe(true); expect(boundary.spawn).not.toHaveBeenCalled();
  });
});

describe("private-input export wrapper", () => {
  it("returns only clean successful output and never adds stdin contents to argv or host environment", async () => {
    const c = child(), input = Buffer.from(`${PRIVATE}\n`), env = deltaChildEnvironment({ PATH: "/synthetic/bin", PGPASSWORD: PRIVATE });
    const result = runDeltaPrivateInput("docker", ["--host", "unix:///var/run/docker.sock", "start", "owned-fixture"], input, 1024, env);
    c.stdout.write("synthetic-schema"); c.emit("close", 0); expect(await result).toBe("synthetic-schema");
    expect(input.every(byte => byte === 0)).toBe(true); expect(JSON.stringify(boundary.spawn.mock.calls)).not.toContain(PRIVATE);
  });
  it.each(["nonzero", "stderr"] as const)("rejects %s without surfacing private output", async kind => {
    const c = child(), result = safeFailure(runDeltaPrivateInput("synthetic", [], Buffer.from(PRIVATE), 1024, {}), "native export failed");
    c.stdout.write(PRIVATE); if (kind === "stderr") c.stderr.write(PRIVATE); c.emit("close", kind === "nonzero" ? 1 : 0); await result;
  });
  it("has a hard sixty-second deadline even when termination receives no acknowledgement", async () => {
    vi.useFakeTimers(); const c = child(false), input = Buffer.from(PRIVATE);
    const result = safeFailure(runDeltaPrivateInput("synthetic", [], input, 1024, {}), "deadline exceeded");
    await vi.advanceTimersByTimeAsync(60_001); await result; expect(c.kill).toHaveBeenCalledWith("SIGKILL"); expect(c.inputReferences[0]!.every(byte => byte === 0)).toBe(true);
  });
});
