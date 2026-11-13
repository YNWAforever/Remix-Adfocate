// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openFramedPsqlSession, parseSinglePsqlJson, PSQL_TRANSPORT_LIMITS, PsqlTransportError,
  type FramedPsqlDependencies, type FramedPsqlOptions, type PsqlChildProcess,
} from "./delta-psql-session";

// Every process and byte below is synthetic. No child process, database, Docker,
// network connection or credential discovery is used by these tests.
const privateText = "FIXTURE_PRIVATE_SQL_AND_INPUT_DO_NOT_REPORT";
const children: MockChild[] = [];
type WriteCallback = (error?: Error | null) => void;
class MockChild extends EventEmitter implements PsqlChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly writes: { copy: Buffer; reference: Buffer }[] = [];
  readonly callbacks: WriteCallback[] = [];
  holdWrites = false;
  autoStart = true;
  autoQuit = true;
  acknowledgeKill = true;
  writeError?: Error;
  throwWrite = false;
  private finished = false;
  readonly kill = vi.fn(() => {
    if (this.acknowledgeKill) queueMicrotask(() => this.finish(137));
    return this.acknowledgeKill;
  });
  constructor() {
    super(); children.push(this);
    this.stdin = new Writable({ write: (chunk: Buffer, _encoding, callback) => {
      if (this.throwWrite) throw new Error(privateText);
      this.writes.push({ copy: Buffer.from(chunk), reference: chunk });
      const text = chunk.toString("utf8");
      if (this.holdWrites) this.callbacks.push(callback);
      else callback(this.writeError);
      if (this.autoStart && text.includes("\\set VERBOSITY sqlstate")) queueMicrotask(() => this.respond([]));
      if (this.autoQuit && text === "\\q\n") queueMicrotask(() => this.finish(0));
    } });
  }
  releaseWrite(error?: Error) { this.callbacks.shift()?.(error); }
  frame() {
    const record = [...this.writes].reverse().find(write => write.copy.toString("utf8").includes("\\echo __adfocate_psql_"));
    if (!record) throw new Error("synthetic frame missing");
    const markers = [...record.copy.toString("utf8").matchAll(/^\\echo (__adfocate_psql_[0-9a-f]{64}_(?:begin|end)__)$/gm)].map(match => match[1]!);
    if (markers.length !== 2) throw new Error("synthetic markers missing");
    return { begin: markers[0]!, end: markers[1]!, input: record.copy.toString("utf8") };
  }
  respond(rows: readonly string[], splitEveryByte = false, crlf = false) {
    const { begin, end } = this.frame();
    const output = Buffer.from([begin, ...rows, end, ""].join(crlf ? "\r\n" : "\n"), "utf8");
    if (splitEveryByte) for (const byte of output) this.stdout.emit("data", Buffer.from([byte]));
    else this.stdout.emit("data", output);
  }
  finish(code: number | null) {
    if (this.finished) return;
    this.finished = true; this.emit("exit", code, null); this.emit("close", code, null);
  }
}
function harness(options: FramedPsqlOptions = {}, configure?: (child: MockChild) => void) {
  const child = new MockChild(); configure?.(child);
  const spawn = vi.fn().mockReturnValue(child);
  const deps: FramedPsqlDependencies = { spawn };
  const opening = openFramedPsqlSession("fixture-fixed-command", ["exec", "-i", "fixture-owned-target", "psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], options, deps);
  return { child, spawn, opening };
}
function captured(promise: Promise<unknown>): Promise<unknown> { return promise.catch(failure => failure); }
async function tick() { await Promise.resolve(); await Promise.resolve(); }
async function safeFailure(promise: Promise<unknown>, code?: string) {
  const failure = await captured(promise);
  expect(failure).toBeInstanceOf(PsqlTransportError);
  const transport = failure as PsqlTransportError;
  if (code) expect(transport.code).toBe(code);
  expect(`${transport.message}\n${transport.stack}\n${JSON.stringify(transport)}`).not.toContain(privateText);
  expect(transport).not.toHaveProperty("cause");
  return transport;
}
afterEach(() => {
  for (const child of children.splice(0)) child.finish(0);
  vi.useRealTimers();
});

describe("persistent framed psql transport (mock subprocess only)", () => {
  it("uses only the caller command and pipe streams, initializes safe quiet settings, and keeps one backend", async () => {
    const { child, spawn, opening } = harness({ cwd: "fixture-working-directory" });
    const session = await opening;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("fixture-fixed-command", expect.any(Array), {
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], cwd: "fixture-working-directory",
    });
    const startup = child.frame().input;
    for (const setting of ["\\set QUIET on", "\\set ON_ERROR_STOP on", "\\set ECHO none", "\\set ECHO_HIDDEN off", "\\set VERBOSITY sqlstate", "\\set SHOW_CONTEXT never", "\\encoding UTF8"]) expect(startup).toContain(setting);
    const first = session.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); child.respond([]); expect(await first).toEqual([]);
    const second = session.query("SELECT '{\"synthetic\":true}'"); child.respond(['{"synthetic":true}']);
    expect(parseSinglePsqlJson(await second)).toEqual({ synthetic: true });
    const third = session.query("ROLLBACK;"); child.respond([]); await third;
    expect(spawn).toHaveBeenCalledTimes(1);
    await session.close(); expect(session.closed).toBe(true);
  });

  it("uses fresh random markers, exact lines, and a terminator before the end marker", async () => {
    const { child, opening } = harness(); const session = await opening;
    const startup = child.frame();
    const pending = session.query("SELECT 1 -- a final line comment");
    const frame = child.frame();
    expect(frame.begin).not.toBe(startup.begin);
    expect(frame.begin).toMatch(/^__adfocate_psql_[0-9a-f]{64}_begin__$/);
    expect(frame.input).toContain("SELECT 1 -- a final line comment\n;\n\\echo");
    child.respond(["1"]); expect(await pending).toEqual(["1"]);
    await session.close();
  });

  it("preserves split markers, multibyte UTF-8 and blank/multiple rows", async () => {
    const { child, opening } = harness(); const session = await opening;
    const expected = ['{"text":"漢🙂é"}', "", "last row"];
    const pending = session.query("SELECT 'synthetic unicode'"); child.respond(expected, true);
    expect(await pending).toEqual(expected);
    await session.close();
  });
  it("accepts CRLF framing and preserves logical rows", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = session.query("SELECT 1;"); child.respond(["1", "2"], false, true);
    expect(await pending).toEqual(["1", "2"]); await session.close();
  });

  it("rejects a concurrent query without interrupting the first query or reconnecting", async () => {
    const { child, spawn, opening } = harness(); const session = await opening;
    const first = session.query("SELECT 1;"); await safeFailure(session.query("SELECT 2;"), "busy");
    child.respond(["1"]); expect(await first).toEqual(["1"]);
    const third = session.query("SELECT 3;"); child.respond(["3"]); expect(await third).toEqual(["3"]);
    expect(spawn).toHaveBeenCalledTimes(1); await session.close();
  });
  it("does not resolve a frame before its input write has been acknowledged", async () => {
    const { child, opening } = harness(); const session = await opening;
    child.holdWrites = true;
    const completed = vi.fn(); const pending = session.query("SELECT 1;").then(rows => { completed(); return rows; });
    child.respond(["1"]); await tick(); expect(completed).not.toHaveBeenCalled();
    child.releaseWrite(); expect(await pending).toEqual(["1"]);
    child.holdWrites = false; await session.close();
  });
  it("rejects close during an active query and then closes idempotently", async () => {
    const { child, opening } = harness(); const session = await opening;
    const query = session.query("SELECT 1;"); await safeFailure(session.close(), "busy");
    child.respond(["1"]); await query;
    const close = session.close(); expect(session.close()).toBe(close); await close;
    expect(child.writes.filter(write => write.copy.equals(Buffer.from("\\q\n")))).toHaveLength(1);
    await safeFailure(session.query("SELECT 2;"), "closed"); await session.abort();
  });

  it.each([0, 1, 3, null])("never treats premature process exit %s as successful SQL", async code => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`));
    child.stdout.emit("data", Buffer.from(`${child.frame().begin}\npartial row\n`)); child.finish(code);
    await safeFailure(pending, "unexpected-exit"); expect(session.closed).toBe(true);
    await safeFailure(session.query("SELECT 2;"), "unexpected-exit");
  });
  it.each(["stdout", "stderr"] as const)("rejects %s EOF before the child acknowledges exit", async source => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query("SELECT 1;")); child[source].emit("end");
    await safeFailure(pending, "unexpected-exit"); await session.abort();
  });
  it("rejects an unexpected clean exit while idle", async () => {
    const { child, opening } = harness(); const session = await opening; child.finish(0);
    await safeFailure(session.close(), "unexpected-exit"); expect(session.closed).toBe(true);
  });
  it("rejects a marker without its complete physical newline", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query("SELECT 1;")); const { begin, end } = child.frame();
    child.stdout.emit("data", Buffer.from(`${begin}\n1\n${end}`)); child.finish(0);
    await safeFailure(pending, "unexpected-exit");
  });
  it("does not accept a suffix lookalike or a marker from an earlier frame", async () => {
    const { child, opening } = harness(); const session = await opening; const old = child.frame();
    const pending = captured(session.query("SELECT 1;")); const frame = child.frame();
    child.stdout.emit("data", Buffer.from(`${frame.begin}\n${old.end}\n${frame.end} \n`)); child.finish(0);
    await safeFailure(pending, "unexpected-exit");
  });
  it.each(["before", "after", "duplicate-begin"])("rejects unframed output %s without returning partial data", async mode => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`)); const { begin, end } = child.frame();
    const output = mode === "before" ? `${privateText}\n${begin}\n${end}\n`
      : mode === "after" ? `${begin}\n${end}\n${privateText}` : `${begin}\n${begin}\n${end}\n`;
    child.stdout.emit("data", Buffer.from(output)); await safeFailure(pending, "protocol-error"); await session.abort();
  });
  it("rejects invalid UTF-8 instead of silently replacing output bytes", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query("SELECT 1;"));
    child.stdout.emit("data", Buffer.concat([Buffer.from(`${child.frame().begin}\n`), Buffer.from([0xc3, 0x28])]));
    await safeFailure(pending, "protocol-error"); await session.abort();
  });

  it("exposes only a SQLSTATE from native errors and never their SQL/detail/context", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`));
    child.stderr.emit("data", Buffer.from(`ERROR:  42601\nDETAIL: ${privateText}\nCONTEXT: ${privateText}\n`));
    const failure = await safeFailure(pending, "stderr-output"); expect(failure.sqlState).toBe("42601"); await session.abort();
  });
  it("redacts unknown or partial stderr without guessing a SQLSTATE", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`)); child.stderr.emit("data", Buffer.from(privateText));
    expect((await safeFailure(pending, "stderr-output")).sqlState).toBeUndefined(); await session.abort();
  });
  it.each(["process", "stdin", "stdout", "stderr"])("redacts %s stream/process errors", async source => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`));
    if (source === "process") child.emit("error", new Error(privateText));
    else child[source as "stdin" | "stdout" | "stderr"].emit("error", new Error(privateText));
    await safeFailure(pending, source === "stdin" ? "stdin-error" : "process-error"); await session.abort();
  });
  it.each(["callback", "throw"])("redacts input write failure via %s", async mode => {
    const { child, opening } = harness(); const session = await opening;
    if (mode === "callback") child.writeError = new Error(privateText); else child.throwWrite = true;
    await safeFailure(session.query(`SELECT '${privateText}';`), "stdin-error"); await session.abort();
  });
  it("redacts synchronous spawn failures", async () => {
    const spawn = vi.fn(() => { throw new Error(privateText); });
    await safeFailure(openFramedPsqlSession("fixture-command", [], {}, { spawn }), "spawn-failed");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("bounds query time and permanently poisons the session on timeout", async () => {
    vi.useFakeTimers(); const { child, opening } = harness({ timeoutMs: 20 });
    await vi.runAllTicks(); const session = await opening;
    const pending = captured(session.query(`SELECT '${privateText}';`));
    await vi.advanceTimersByTimeAsync(21); await safeFailure(pending, "query-timeout");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL"); await safeFailure(session.query("SELECT 2;"), "query-timeout"); await session.abort();
  });
  it("bounds startup even when no prefix marker ever arrives", async () => {
    vi.useFakeTimers(); const { child, opening } = harness({ timeoutMs: 20 }, child => { child.autoStart = false; });
    const failure = captured(opening); await vi.advanceTimersByTimeAsync(21); await safeFailure(failure, "query-timeout");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it("bounds graceful close and force-stops a child that will not exit", async () => {
    vi.useFakeTimers(); const { child, opening } = harness({ closeTimeoutMs: 20 }, child => { child.autoQuit = false; });
    await vi.runAllTicks(); const session = await opening;
    const pending = captured(session.close()); await vi.advanceTimersByTimeAsync(21); await safeFailure(pending, "close-timeout");
    expect(child.kill).toHaveBeenCalledTimes(1); expect(child.stdin.destroyed).toBe(true);
  });
  it("reports an unacknowledged abort honestly and still handles a later close event", async () => {
    vi.useFakeTimers(); const { child, opening } = harness({ closeTimeoutMs: 20 }, child => { child.acknowledgeKill = false; });
    await vi.runAllTicks(); const session = await opening;
    const pending = captured(session.abort()); expect(session.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(21); await safeFailure(pending, "close-timeout"); expect(session.closed).toBe(false);
    child.finish(137); expect(session.closed).toBe(true);
  });
  it("aborts an active query, destroys streams, and acknowledges local close without claiming rollback", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query("BEGIN;")); await session.abort();
    await safeFailure(pending, "aborted"); expect(session.closed).toBe(true); await session.closePromise;
    expect([child.stdin.destroyed, child.stdout.destroyed, child.stderr.destroyed]).toEqual([true, true, true]);
    await safeFailure(session.close(), "aborted"); expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("bounds row data exactly even when a complete frame fits its marker overhead", async () => {
    const { child, opening } = harness({ maxOutputBytes: 5 }); const session = await opening;
    const pending = captured(session.query("SELECT 1;")); child.respond(["123456"]);
    await safeFailure(pending, "output-limit"); await session.abort();
  });
  it("bounds an unterminated output line and excessive stderr", async () => {
    for (const source of ["stdout", "stderr"] as const) {
      const { child, opening } = harness({ maxOutputBytes: 16 }); const session = await opening;
      const pending = captured(session.query("SELECT 1;")); child[source].emit("data", Buffer.alloc(1024, 65));
      await safeFailure(pending, "output-limit"); await session.abort();
    }
  });
  it("bounds row count independently from byte count", async () => {
    const { child, opening } = harness(); const session = await opening;
    const pending = captured(session.query("SELECT 1;")); const { begin, end } = child.frame();
    child.stdout.emit("data", Buffer.from(`${begin}\n${"\n".repeat(PSQL_TRANSPORT_LIMITS.outputLines + 1)}${end}\n`));
    await safeFailure(pending, "output-limit"); await session.abort();
  });

  it("passes initial input only through stdin and clears both caller and private copies", async () => {
    const initial = Buffer.from(`${privateText}\n`);
    const { child, spawn, opening } = harness({ initialInputBuffer: initial }, child => { child.holdWrites = true; });
    expect(initial.every(byte => byte === 0)).toBe(true);
    expect(child.writes[0]!.copy.toString("utf8")).toBe(`${privateText}\n`);
    expect(child.writes[0]!.reference.every(byte => byte === 0)).toBe(false);
    expect(JSON.stringify(spawn.mock.calls)).not.toContain(privateText);
    child.holdWrites = false; child.releaseWrite(); const session = await opening;
    expect(child.writes[0]!.reference.every(byte => byte === 0)).toBe(true);
    await session.close();
  });
  it("clears private initial input if its write never acknowledges before startup timeout", async () => {
    vi.useFakeTimers(); const initial = Buffer.from(`${privateText}\n`);
    const { child, opening } = harness({ initialInputBuffer: initial, timeoutMs: 20 }, child => { child.holdWrites = true; });
    const pending = captured(opening); await vi.advanceTimersByTimeAsync(21); await safeFailure(pending, "query-timeout");
    expect(initial.every(byte => byte === 0)).toBe(true); expect(child.writes[0]!.reference.every(byte => byte === 0)).toBe(true);
  });
  it("clears initial input even if spawn fails", async () => {
    const initial = Buffer.from(privateText); const spawn = vi.fn(() => { throw new Error(privateText); });
    await safeFailure(openFramedPsqlSession("fixture-command", [], { initialInputBuffer: initial }, { spawn }), "spawn-failed");
    expect(initial.every(byte => byte === 0)).toBe(true);
  });

  it.each([
    { timeoutMs: 0 }, { timeoutMs: 60_001 }, { timeoutMs: Number.NaN }, { closeTimeoutMs: 60_001 },
    { maxOutputBytes: 0 }, { maxOutputBytes: PSQL_TRANSPORT_LIMITS.outputBytes + 1 }, { unexpected: privateText },
  ])("rejects invalid limits/options before any spawn: %j", async options => {
    const spawn = vi.fn(); await safeFailure(openFramedPsqlSession("fixture-command", [], options as FramedPsqlOptions, { spawn }), "invalid-options");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects invalid SQL values without poisoning an otherwise usable session", async () => {
    const { child, opening } = harness(); const session = await opening;
    await safeFailure(session.query("SELECT\0"), "invalid-query");
    const query = session.query("SELECT 1;"); child.respond(["1"]); expect(await query).toEqual(["1"]); await session.close();
  });
});

describe("single psql JSON row", () => {
  it("parses one JSON value without promoting it to a validated collector schema", () => {
    expect(parseSinglePsqlJson([' {"synthetic":true,"text":"漢🙂"} '])).toEqual({ synthetic: true, text: "漢🙂" });
    expect(parseSinglePsqlJson(["null"])).toBeNull();
  });
  it.each([[], [""], [" "], [privateText], ["{truncated"], ['{"x":1}', '{"x":2}'], ['{\n"x":1\n}']].map(rows => ({ rows })))("rejects malformed, multiline or multiple JSON rows", ({ rows }) => {
    expect(() => parseSinglePsqlJson(rows)).toThrow(PsqlTransportError);
    try { parseSinglePsqlJson(rows); } catch (failure) {
      expect((failure as Error).message).not.toContain(privateText);
      expect(failure).not.toHaveProperty("cause");
    }
  });
});
