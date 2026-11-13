// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDeltaPrivateBinary } from "./delta-private-binary";
const PRIVATE = "nonsecret-private-binary-fixture";
class Child extends EventEmitter {
  readonly stdout = new PassThrough(); readonly stderr = new PassThrough(); readonly inputs: Buffer[] = []; readonly copies: Buffer[] = [];
  readonly stdin = new Writable({ write: (chunk: Buffer, _encoding, done) => { this.inputs.push(chunk); this.copies.push(Buffer.from(chunk)); if (this.acknowledge) done(); } });
  readonly kill = vi.fn(() => false); readonly unref = vi.fn(); constructor(readonly acknowledge = true) { super(); }
}
afterEach(() => vi.useRealTimers());
function fixture(ack = true) { const child = new Child(ack), spawn = vi.fn(() => child); return { child, spawn }; }
async function rejectsSafe(promise: Promise<unknown>) { const error = await promise.then(() => undefined, error => error as Error); expect(error).toBeInstanceOf(Error); expect(`${error!.message}\n${error!.stack}`).not.toContain(PRIVATE); expect(error).not.toHaveProperty("cause"); }
describe("private byte process boundary with fully mocked children", () => {
  it("preserves arbitrary archive bytes including NUL, invalid UTF8 and CRLF without decoding", async () => {
    const f = fixture(), input = Buffer.from(PRIVATE), source = Buffer.from([80,71,68,77,80,0,255,254,128,13,10]), expected = Buffer.from(source);
    const result = runDeltaPrivateBinary("fixed", ["fixed-arg"], input, 1024, {}, { spawn: f.spawn });
    expect(input.every(byte => byte === 0)).toBe(true); f.child.stdout.write(source); f.child.emit("close", 0);
    const output = await result; expect(output).toEqual(expected); expect(source.every(byte => byte === 0)).toBe(true); expect(f.child.inputs[0]!.every(byte => byte === 0)).toBe(true); output.fill(0);
  });
  it("reads only allowlisted host settings and never exposes data in argv or environment", async () => {
    const f = fixture(), forbidden = vi.fn(() => { throw new Error(PRIVATE); }), env: NodeJS.ProcessEnv = { PATH: "/synthetic/bin" };
    for (const key of ["PGPASSWORD", "VERCEL_AUTOMATION_BYPASS_SECRET", "GITHUB_TOKEN", "DOCKER_HOST"]) Object.defineProperty(env, key, { enumerable: true, get: forbidden });
    const result = runDeltaPrivateBinary("fixed", [], Buffer.from(PRIVATE), 10, env, { spawn: f.spawn }); f.child.emit("close", 0); (await result).fill(0);
    expect(forbidden).not.toHaveBeenCalled(); expect(f.spawn).toHaveBeenCalledWith("fixed", [], { env: { PATH: "/synthetic/bin", GIT_TERMINAL_PROMPT: "0" }, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    expect(JSON.stringify(f.spawn.mock.calls)).not.toContain(PRIVATE);
  });
  it.each(["stderr", "nonzero", "error", "stdout-error", "stdin-error"])("clears pending private bytes on %s and returns only fixed errors", async kind => {
    const f = fixture(false), chunk = Buffer.from(PRIVATE), input = Buffer.from(PRIVATE);
    const result = rejectsSafe(runDeltaPrivateBinary("fixed", [], input, 1024, {}, { spawn: f.spawn })); f.child.stdout.write(chunk);
    if (kind === "stderr") { const diagnostic = Buffer.from(PRIVATE); f.child.stderr.write(diagnostic); expect(diagnostic.every(byte => byte === 0)).toBe(true); }
    else if (kind === "nonzero") f.child.emit("close", 1);
    else if (kind === "error") f.child.emit("error", new Error(PRIVATE));
    else if (kind === "stdout-error") f.child.stdout.emit("error", new Error(PRIVATE)); else f.child.stdin.emit("error", new Error(PRIVATE));
    await result; expect(input.every(byte => byte === 0)).toBe(true); expect(chunk.every(byte => byte === 0)).toBe(true); expect(f.child.inputs[0]!.every(byte => byte === 0)).toBe(true);
  });
  it("settles a deadline without close or kill acknowledgement even if cleanup methods throw", async () => {
    vi.useFakeTimers(); const f = fixture(false); f.child.kill.mockImplementation(() => { throw new Error(PRIVATE); }); f.child.unref.mockImplementation(() => { throw new Error(PRIVATE); });
    const result = rejectsSafe(runDeltaPrivateBinary("fixed", [], Buffer.from(PRIVATE), 10, {}, { spawn: f.spawn, timeoutMs: 5 }));
    await vi.advanceTimersByTimeAsync(6); await result; expect(f.child.inputs[0]!.every(byte => byte === 0)).toBe(true);
  });
  it("rejects output overflow and clears the overflowing source chunk", async () => {
    const f = fixture(), chunk = Buffer.from(PRIVATE), result = rejectsSafe(runDeltaPrivateBinary("fixed", [], Buffer.alloc(0), 1, {}, { spawn: f.spawn }));
    f.child.stdout.write(chunk); await result; expect(chunk.every(byte => byte === 0)).toBe(true);
  });
  it.each([0, -1, Number.NaN, 1.1, 257 * 1024 * 1024])("clears input on invalid maximum output size %s before spawning", async limit => {
    const f = fixture(), input = Buffer.from(PRIVATE); await rejectsSafe(runDeltaPrivateBinary("fixed", [], input, limit, {}, { spawn: f.spawn }));
    expect(input.every(byte => byte === 0)).toBe(true); expect(f.spawn).not.toHaveBeenCalled();
  });
  it("clears the input if spawn throws or an allowlisted environment getter fails", async () => {
    const input = Buffer.from(PRIVATE), spawn = vi.fn(() => { throw new Error(PRIVATE); });
    await rejectsSafe(runDeltaPrivateBinary("fixed", [], input, 10, {}, { spawn })); expect(input.every(byte => byte === 0)).toBe(true);
    const second = Buffer.from(PRIVATE), env = {}; Object.defineProperty(env, "PATH", { enumerable: true, get: () => { throw new Error(PRIVATE); } });
    await rejectsSafe(runDeltaPrivateBinary("fixed", [], second, 10, env, { spawn })); expect(second.every(byte => byte === 0)).toBe(true);
  });
});
