import { spawn as spawnProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { TextDecoder } from "node:util";

export const PSQL_TRANSPORT_LIMITS = Object.freeze({ outputBytes: 32 * 1024 * 1024, outputLines: 100_000,
  timeoutMs: 60_000, initialInputBytes: 64 * 1024 });
export type PsqlTransportFailureCode = "invalid-options" | "invalid-query" | "spawn-failed" | "process-error"
  | "unexpected-exit" | "protocol-error" | "query-timeout" | "output-limit" | "stdin-error" | "stderr-output"
  | "busy" | "closed" | "aborted" | "close-timeout" | "json-result";

/** No original process error, SQL, arguments, stdout, stderr or cause is retained. */
export class PsqlTransportError extends Error {
  readonly sqlState?: string;
  constructor(readonly code: PsqlTransportFailureCode, sqlState?: string) {
    const safeState = typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : undefined;
    super(`Psql transport failed: ${code}${safeState ? ` (SQLSTATE ${safeState})` : ""}`);
    this.name = "PsqlTransportError";
    this.sqlState = safeState;
  }
}
export interface PsqlChildProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}
export interface PsqlSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: ["pipe", "pipe", "pipe"];
  readonly cwd?: string;
}
export interface FramedPsqlDependencies {
  readonly spawn?: (file: string, args: readonly string[], options: PsqlSpawnOptions) => PsqlChildProcess;
}
export interface FramedPsqlOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Consumed: the caller buffer is cleared after copying; its private copy is cleared after writing or failure. */
  readonly initialInputBuffer?: Buffer;
}
export interface FramedPsqlSession {
  query(sql: string): Promise<readonly string[]>;
  close(): Promise<void>;
  /** Force local transport shutdown. Acknowledgement is not proof of a database rollback. */
  abort(): Promise<void>;
  /** True only after the local child emits close. */
  readonly closed: boolean;
  /** Resolves on local child close (any exit status); rejects if shutdown remains unacknowledged. */
  readonly closePromise: Promise<void>;
}
interface Limits { timeoutMs: number; closeTimeoutMs: number; outputBytes: number }
interface Frame {
  readonly begin: string; readonly end: string; readonly rows: string[];
  readonly resolve: (rows: readonly string[]) => void; readonly reject: (error: PsqlTransportError) => void;
  readonly timer: ReturnType<typeof setTimeout>; readonly wireLimit: number;
  started: boolean; ended: boolean; writeAcknowledged: boolean; bytes: number; payloadBytes: number;
}
const INITIALIZE = "\\set QUIET on\n\\set ON_ERROR_STOP on\n\\set ECHO none\n\\set ECHO_HIDDEN off\n\\set VERBOSITY sqlstate\n\\set SHOW_CONTEXT never\n\\encoding UTF8\n\\pset format unaligned\n\\pset tuples_only on\n\\pset pager off\n";
const error = (code: PsqlTransportFailureCode, state?: string) => new PsqlTransportError(code, state);
function bounded(value: unknown, fallback: number, maximum: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1 || result > maximum) throw error("invalid-options");
  return result;
}

class Session implements FramedPsqlSession {
  readonly closePromise: Promise<void>;
  private acknowledgeClose!: () => void;
  private rejectClose!: (error: PsqlTransportError) => void;
  private closeSettled = false;
  private didClose = false;
  private closing = false;
  private stopRequested = false;
  private failure?: PsqlTransportError;
  private frame?: Frame;
  private stdoutTail = "";
  private pendingUtf8Bytes = 0;
  private stderrTail = "";
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private readonly utf8Guard = new TextDecoder("utf-8", { fatal: true });
  private shutdownTimer?: ReturnType<typeof setTimeout>;
  private normalClose?: Promise<void>;
  private privateInitialInput?: Buffer;

  constructor(private readonly child: PsqlChildProcess, private readonly limits: Limits) {
    this.closePromise = new Promise<void>((resolve, reject) => { this.acknowledgeClose = resolve; this.rejectClose = reject; });
    // Opening can fail before the caller receives the session. Cleanup still runs, without an unhandled rejection.
    void this.closePromise.catch(() => undefined);
    child.stdout.on("data", chunk => this.stdout(chunk));
    child.stderr.on("data", chunk => this.stderr(chunk));
    for (const stream of [child.stdout, child.stderr]) stream.on("end", () => {
      if (!this.closing || this.frame) this.fail(error("unexpected-exit"));
    });
    child.stdin.on("error", () => this.fail(error("stdin-error")));
    child.stdout.on("error", () => this.fail(error("process-error")));
    child.stderr.on("error", () => this.fail(error("process-error")));
    child.on("error", () => this.fail(error("process-error")));
    child.once("exit", (code: number | null) => {
      if (!this.closing || this.frame || code !== 0) this.fail(error("unexpected-exit"));
    });
    child.once("close", (code: number | null) => this.onClose(code));
  }
  get closed() { return this.didClose; }

  start(initialInput?: Buffer): Promise<void> {
    this.privateInitialInput = initialInput;
    return this.runFrame("", true).then(() => undefined);
  }
  query(sql: string): Promise<readonly string[]> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing || this.didClose) return Promise.reject(error("closed"));
    if (this.frame) return Promise.reject(error("busy"));
    if (typeof sql !== "string" || sql.includes("\0") || Buffer.byteLength(sql, "utf8") > PSQL_TRANSPORT_LIMITS.outputBytes) return Promise.reject(error("invalid-query"));
    return this.runFrame(sql, false);
  }
  private runFrame(sql: string, initialize: boolean): Promise<readonly string[]> {
    if (this.failure || this.didClose || this.closing || this.frame) return Promise.reject(this.failure ?? error("closed"));
    return new Promise<readonly string[]>((resolve, reject) => {
      let nonce: string;
      try { nonce = randomBytes(32).toString("hex"); }
      catch { const reason = error("process-error"); this.fail(reason); reject(reason); return; }
      const begin = `__adfocate_psql_${nonce}_begin__`, end = `__adfocate_psql_${nonce}_end__`;
      const frame: Frame = { begin, end, rows: [], resolve, reject, started: false, ended: false, writeAcknowledged: false, bytes: 0, payloadBytes: 0,
        wireLimit: this.limits.outputBytes + Buffer.byteLength(begin + end, "utf8") + 4,
        timer: setTimeout(() => this.fail(error("query-timeout")), this.limits.timeoutMs) };
      this.frame = frame;
      // The extra semicolon executes an unterminated SQL statement; a marker alone must never imply execution.
      const payload = `${initialize ? INITIALIZE : ""}\\echo ${begin}\n${sql}\n;\n\\echo ${end}\n`;
      const sendFrame = () => {
        if (this.frame !== frame || this.failure) return;
        try {
          this.child.stdin.write(payload, (writeError?: Error | null) => {
            if (writeError) this.fail(error("stdin-error"));
            else { frame.writeAcknowledged = true; this.completeFrame(); }
          });
        } catch { this.fail(error("stdin-error")); }
      };
      if (this.privateInitialInput) {
        const input = this.privateInitialInput;
        try {
          this.child.stdin.write(input, (writeError?: Error | null) => {
            input.fill(0); this.privateInitialInput = undefined;
            if (writeError) this.fail(error("stdin-error")); else sendFrame();
          });
        } catch { input.fill(0); this.privateInitialInput = undefined; this.fail(error("stdin-error")); }
      } else sendFrame();
    });
  }
  private stdout(chunk: unknown) {
    if (this.failure || this.didClose) return;
    if (!Buffer.isBuffer(chunk) && typeof chunk !== "string") { this.fail(error("protocol-error")); return; }
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const frame = this.frame;
    if (!frame) { if (bytes.length) this.fail(error("protocol-error")); return; }
    frame.bytes += bytes.length;
    if (frame.bytes > frame.wireLimit) { this.fail(error("output-limit")); return; }
    try { this.utf8Guard.decode(bytes, { stream: true }); } catch { this.fail(error("protocol-error")); return; }
    const decoded = this.stdoutDecoder.write(bytes);
    this.pendingUtf8Bytes += bytes.length - Buffer.byteLength(decoded, "utf8");
    this.stdoutTail += decoded;
    let newline: number;
    while ((newline = this.stdoutTail.indexOf("\n")) >= 0) {
      const raw = this.stdoutTail.slice(0, newline);
      this.stdoutTail = this.stdoutTail.slice(newline + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!frame.started) {
        if (line !== frame.begin) { this.fail(error("protocol-error")); return; }
        frame.started = true;
      } else if (frame.ended) { this.fail(error("protocol-error")); return; }
      else if (line === frame.end) frame.ended = true;
      else {
        frame.payloadBytes += Buffer.byteLength(raw, "utf8") + 1;
        if (frame.payloadBytes > this.limits.outputBytes || frame.rows.length >= PSQL_TRANSPORT_LIMITS.outputLines) { this.fail(error("output-limit")); return; }
        if (line === frame.begin) { this.fail(error("protocol-error")); return; }
        frame.rows.push(line);
      }
    }
    if (frame.ended && (this.stdoutTail.length || this.pendingUtf8Bytes)) { this.fail(error("protocol-error")); return; }
    this.completeFrame();
  }
  private stderr(chunk: unknown) {
    if (this.failure || this.didClose) return;
    if (!Buffer.isBuffer(chunk) && typeof chunk !== "string") { this.fail(error("stderr-output")); return; }
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (!bytes.length) return;
    if (bytes.length > this.limits.outputBytes) { this.fail(error("output-limit")); return; }
    const decoded = this.stderrDecoder.write(bytes.subarray(0, 256));
    // Only a short prefix is inspected, and only a five-character SQLSTATE may leave the transport.
    this.stderrTail = decoded;
    const match = /(?:^|\n)(?:psql:[^\r\n]*?:\s*)?(?:ERROR|FATAL|PANIC):[ \t]+([0-9A-Z]{5})(?:\r?\n|$)/.exec(this.stderrTail);
    this.fail(error("stderr-output", match?.[1]));
    this.stderrTail = "";
  }
  private completeFrame() {
    const frame = this.frame;
    if (!frame || !frame.ended || !frame.writeAcknowledged || this.failure || this.stdoutTail.length || this.pendingUtf8Bytes) return;
    clearTimeout(frame.timer); this.frame = undefined;
    frame.resolve(Object.freeze([...frame.rows]));
    frame.rows.length = 0;
  }
  private fail(reason: PsqlTransportError) {
    if (!this.failure) this.failure = reason;
    if (this.frame) {
      const frame = this.frame; this.frame = undefined; clearTimeout(frame.timer); frame.rows.length = 0; frame.reject(this.failure);
    }
    this.privateInitialInput?.fill(0); this.privateInitialInput = undefined; this.stdoutTail = ""; this.stderrTail = "";
    if (this.didClose || this.stopRequested) return;
    this.stopRequested = true; this.closing = true; this.armShutdown();
    try { this.child.stdin.destroy(); } catch { /* private native errors are never surfaced */ }
    try { this.child.stdout.destroy(); } catch { /* failure remains generic */ }
    try { this.child.stderr.destroy(); } catch { /* failure remains generic */ }
    try { this.child.kill("SIGKILL"); } catch { /* shutdown acknowledgement remains bounded */ }
  }
  private armShutdown() {
    if (this.shutdownTimer || this.closeSettled) return;
    this.shutdownTimer = setTimeout(() => {
      this.shutdownTimer = undefined;
      if (this.closeSettled) return;
      this.closeSettled = true;
      const reason = error("close-timeout");
      this.fail(reason);
      this.rejectClose(reason);
    }, this.limits.closeTimeoutMs);
  }
  private onClose(code: number | null) {
    if (this.didClose) return;
    this.didClose = true;
    if (!this.closing || this.frame || code !== 0) this.fail(error("unexpected-exit"));
    if (this.shutdownTimer) { clearTimeout(this.shutdownTimer); this.shutdownTimer = undefined; }
    this.privateInitialInput?.fill(0); this.privateInitialInput = undefined; this.stdoutTail = ""; this.stderrTail = "";
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      try { stream.destroy(); } catch { /* local disposal cannot authenticate a database outcome */ }
    }
    if (!this.closeSettled) { this.closeSettled = true; this.acknowledgeClose(); }
  }
  close(): Promise<void> {
    if (this.normalClose) return this.normalClose;
    if (this.frame && !this.failure) return Promise.reject(error("busy"));
    this.normalClose = (async () => {
      if (!this.didClose && !this.failure) {
        this.closing = true; this.armShutdown();
        try { this.child.stdin.end("\\q\n", (writeError?: Error | null) => { if (writeError) this.fail(error("stdin-error")); }); }
        catch { this.fail(error("stdin-error")); }
      }
      await this.closePromise;
      if (this.failure) throw this.failure;
    })();
    void this.normalClose.catch(() => undefined);
    return this.normalClose;
  }
  abort(): Promise<void> {
    if (!this.didClose && !this.failure) this.fail(error("aborted"));
    return this.closePromise;
  }
}

/**
 * Uses the caller's fixed, already-authorized command and target. This function
 * performs no credential discovery, host selection, retry or reconnection.
 * Callers must use psql -X -q -t -A with ON_ERROR_STOP=1 and pipe all three streams.
 * Query inputs are caller-reviewed SQL, not psql scripts or client metacommands.
 */
export async function openFramedPsqlSession(file: string, args: readonly string[], options: FramedPsqlOptions = {}, deps: FramedPsqlDependencies = {}): Promise<FramedPsqlSession> {
  let privateInput: Buffer | undefined;
  try {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw error("invalid-options");
    const initial = options.initialInputBuffer;
    if (initial !== undefined) {
      if (!Buffer.isBuffer(initial)) throw error("invalid-options");
      try {
        if (initial.length > PSQL_TRANSPORT_LIMITS.initialInputBytes) throw error("invalid-options");
        privateInput = Buffer.from(initial);
      } finally { initial.fill(0); }
    }
    if (Object.keys(options).some(key => !["cwd", "timeoutMs", "closeTimeoutMs", "maxOutputBytes", "initialInputBuffer"].includes(key))
      || typeof file !== "string" || !file || file.includes("\0") || file.length > 4096
      || !Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== "string" || arg.includes("\0") || arg.length > 4096)
      || (options.cwd !== undefined && (typeof options.cwd !== "string" || !options.cwd || options.cwd.includes("\0")))) throw error("invalid-options");
    const limits: Limits = { timeoutMs: bounded(options.timeoutMs, 30_000, PSQL_TRANSPORT_LIMITS.timeoutMs),
      closeTimeoutMs: bounded(options.closeTimeoutMs, 5_000, PSQL_TRANSPORT_LIMITS.timeoutMs),
      outputBytes: bounded(options.maxOutputBytes, PSQL_TRANSPORT_LIMITS.outputBytes, PSQL_TRANSPORT_LIMITS.outputBytes) };
    let child: PsqlChildProcess;
    try { child = (deps.spawn ?? ((command, argv, spawnOptions) => spawnProcess(command, [...argv], spawnOptions)))(file, [...args],
      { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(options.cwd === undefined ? {} : { cwd: options.cwd }) }); }
    catch { throw error("spawn-failed"); }
    const session = new Session(child, limits);
    await session.start(privateInput);
    privateInput = undefined;
    return session;
  } catch (failure) {
    privateInput?.fill(0);
    throw failure instanceof PsqlTransportError ? failure : error("process-error");
  }
}

/** Exactly one physical JSON row; its schema still requires the collector's validator. */
export function parseSinglePsqlJson(rows: readonly string[]): unknown {
  try {
    if (!Array.isArray(rows) || rows.length !== 1 || Object.keys(rows).length !== 1 || typeof rows[0] !== "string"
      || /[\r\n]/.test(rows[0]) || Buffer.byteLength(rows[0], "utf8") > PSQL_TRANSPORT_LIMITS.outputBytes) throw error("json-result");
    return JSON.parse(rows[0]);
  } catch { throw error("json-result"); }
}
