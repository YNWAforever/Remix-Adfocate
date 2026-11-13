import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { deltaChildEnvironment } from "./delta-child-process";

export const DELTA_PRIVATE_BINARY_MAXIMUM = 256 * 1024 * 1024;
export interface DeltaPrivateBinaryChild {
  readonly stdin: Writable | null; readonly stdout: Readable | null; readonly stderr: Readable | null;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean; unref?(): void;
}
export interface DeltaPrivateBinaryDependencies {
  readonly spawn?: (file: string, args: string[], options: { env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: ["pipe", "pipe", "pipe"] }) => DeltaPrivateBinaryChild;
  readonly timeoutMs?: number;
}
function held(): Error { return new Error("private binary operation held"); }
/** Consumes input. Successful output belongs to the caller, who must clear it. No text decoding occurs. */
export async function runDeltaPrivateBinary(file: string, args: readonly string[], input: Buffer, maximumOutputBytes: number,
  env: NodeJS.ProcessEnv = process.env, dependencies: DeltaPrivateBinaryDependencies = {}): Promise<Buffer> {
  let privateInput: Buffer | undefined;
  let childEnvironment: NodeJS.ProcessEnv;
  const timeout = dependencies.timeoutMs ?? 60_000;
  try {
    if (!Buffer.isBuffer(input) || input.length > DELTA_PRIVATE_BINARY_MAXIMUM || typeof file !== "string" || !file || file.includes("\0")
      || !Array.isArray(args) || args.length > 256 || args.some(value => typeof value !== "string" || value.includes("\0"))
      || !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > DELTA_PRIVATE_BINARY_MAXIMUM
      || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000) throw held();
    privateInput = Buffer.from(input); input.fill(0);
    childEnvironment = deltaChildEnvironment(env);
  } catch { if (Buffer.isBuffer(input)) input.fill(0); privateInput?.fill(0); throw held(); }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0, settled = false;
    let child: DeltaPrivateBinaryChild | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { privateInput?.fill(0); for (const chunk of chunks) chunk.fill(0); chunks.length = 0; };
    const stop = () => {
      try { child?.kill("SIGKILL"); } catch { /* Acknowledgement is not a settlement condition. */ }
      for (const stream of [child?.stdin, child?.stdout, child?.stderr]) { try { stream?.destroy(); } catch { /* Continue clearing and settling. */ } }
      try { child?.unref?.(); } catch { /* Continue settling. */ }
    };
    const finish = (success = false) => {
      if (settled) return; settled = true; if (timer) clearTimeout(timer);
      if (!success) { stop(); clear(); reject(held()); return; }
      try { const output = Buffer.concat(chunks, length); clear(); resolve(output); }
      catch { stop(); clear(); reject(held()); }
    };
    try {
      child = (dependencies.spawn ?? ((name, argv, options) => spawn(name, argv, options) as unknown as DeltaPrivateBinaryChild))(
        file, [...args], { env: childEnvironment, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      if (!child.stdin || !child.stdout || !child.stderr) { finish(); return; }
      timer = setTimeout(() => finish(), timeout);
      child.stdout.on("data", (chunk: unknown) => {
        if (!Buffer.isBuffer(chunk)) { finish(); return; }
        try {
          if (settled) return;
          if (length + chunk.length > maximumOutputBytes) { finish(); return; }
          chunks.push(Buffer.from(chunk)); length += chunk.length;
        } catch { finish(); } finally { chunk.fill(0); }
      });
      child.stderr.on("data", (chunk: unknown) => { if (Buffer.isBuffer(chunk)) chunk.fill(0); finish(); });
      child.stdout.on("error", () => finish()); child.stderr.on("error", () => finish()); child.stdin.on("error", () => finish());
      child.once("error", () => finish()); child.once("close", code => finish(code === 0));
      child.stdin.end(privateInput, () => privateInput?.fill(0));
    } catch { finish(); }
  });
}
