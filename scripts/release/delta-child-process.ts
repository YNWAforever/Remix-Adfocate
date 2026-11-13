import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./process";

const ALLOWED = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
  "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "DOCKER_CONFIG", "LANG", "LC_ALL"]);
/** Read only approved host settings; never propagate release/provider credentials or Docker routing overrides. */
export function deltaChildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(source)) if (ALLOWED.has(key.toUpperCase()) && typeof source[key] === "string") result[key] = source[key];
  result.GIT_TERMINAL_PROMPT = "0";
  return Object.freeze(result);
}
export function deltaLocalDockerEndpoint(platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") return "npipe:////./pipe/dockerDesktopLinuxEngine";
  if (platform === "linux") return "unix:///var/run/docker.sock";
  throw new Error("protected release Docker platform unsupported");
}
interface BoundedOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: Buffer;
  readonly timeoutMs?: number;
  readonly maximumOutputBytes?: number;
}
/** Deadline settles even when a child never acknowledges termination. No raw process error is exposed. */
export async function boundedDeltaCommand(file: string, args: readonly string[], options: BoundedOptions = {}): Promise<CommandResult> {
  const timeout = options.timeoutMs ?? 30_000, limit = options.maximumOutputBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32 * 1024 * 1024) {
    options.input?.fill(0);
    throw new Error("protected release process limits invalid");
  }
  const input = options.input ? Buffer.from(options.input) : undefined;
  options.input?.fill(0);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(file, [...args], { cwd: options.cwd, env: options.env ?? deltaChildEnvironment(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { input?.fill(0); reject(new Error("protected release process unavailable")); return; }
    const output: Buffer[] = [], errors: Buffer[] = [];
    let bytes = 0, errorBytes = 0, settled = false;
    const finish = (reason?: string, code?: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); input?.fill(0);
      if (reason) {
        try { child.kill("SIGKILL"); } catch { /* ownership reconciliation is handled by the caller */ }
        child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.();
        reject(new Error(`protected release process ${reason}`));
      } else resolve({ code: code ?? 1, stdout: Buffer.concat(output).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") });
    };
    const timer = setTimeout(() => finish("deadline exceeded"), timeout);
    child.stdout?.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) finish("output bound exceeded"); else output.push(chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 64 * 1024) finish("error-output bound exceeded"); else errors.push(chunk); });
    child.stdout?.on("error", () => finish("stdout failed"));
    child.stderr?.on("error", () => finish("stderr failed"));
    child.once("error", () => finish("unavailable"));
    child.once("close", code => finish(undefined, code));
    child.stdin?.on("error", () => finish("stdin failed"));
    child.stdin?.end(input, () => input?.fill(0));
  });
}
export const runDeltaCommand: CommandRunner = (file, args, options = {}) => boundedDeltaCommand(file, args, options);
export async function runDeltaPrivateInput(file: string, args: string[], input: Buffer, limit: number, env = deltaChildEnvironment()) {
  const result = await boundedDeltaCommand(file, args, { input, env, maximumOutputBytes: limit, timeoutMs: 60_000 });
  if (result.code !== 0 || result.stderr) throw new Error("protected native export failed");
  return result.stdout;
}
