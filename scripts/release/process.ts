import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

interface SpawnedCommand {
  readonly stdout: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
}

type SpawnCommand = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell: false; windowsHide: true },
) => SpawnedCommand;

export function commandInvocationFor(
  file: string,
  args: readonly string[],
  platform = process.platform,
  nodeExecutable = process.execPath,
) {
  if (file === "npx" && platform === "win32") {
    return {
      file: nodeExecutable,
      args: [
        join(dirname(nodeExecutable), "node_modules", "npm", "bin", "npx-cli.js"),
        ...args,
      ],
    };
  }
  return { file, args: [...args] };
}

export function createCommandRunner(
  spawnCommand: SpawnCommand,
  platform = process.platform,
  nodeExecutable = process.execPath,
): CommandRunner {
  return (file, args, options = {}) =>
    new Promise((resolve, reject) => {
      const invocation = commandInvocationFor(file, args, platform, nodeExecutable);
      const child = spawnCommand(invocation.file, invocation.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

export const runCommand = createCommandRunner(
  (file, args, options) => spawn(file, args, options) as unknown as SpawnedCommand,
);
