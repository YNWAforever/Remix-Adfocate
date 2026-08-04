import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commandInvocationFor, createCommandRunner } from "./process";

describe("release command runner", () => {
  it("executes npm's npx CLI through Node on Windows while preserving shell:false", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    const spawn = vi.fn().mockReturnValue(child);
    const run = createCommandRunner(spawn, "win32", "C:/node/node.exe");
    const result = run("npx", ["supabase", "migration", "list"]);

    child.emit("close", 0);

    await expect(result).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
    expect(commandInvocationFor("npx", ["supabase"], "win32", "C:/node/node.exe")).toEqual({
      file: "C:/node/node.exe",
      args: [join("C:/node", "node_modules", "npm", "bin", "npx-cli.js"), "supabase"],
    });
    expect(spawn).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [
        join("C:/node", "node_modules", "npm", "bin", "npx-cli.js"),
        "supabase",
        "migration",
        "list",
      ],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });
});
