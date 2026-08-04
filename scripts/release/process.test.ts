import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { commandFileFor, createCommandRunner } from "./process";

describe("release command runner", () => {
  it("uses the Windows npx command shim while preserving shell:false", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    const spawn = vi.fn().mockReturnValue(child);
    const run = createCommandRunner(spawn, "win32");
    const result = run("npx", ["supabase", "migration", "list"]);

    child.emit("close", 0);

    await expect(result).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
    expect(commandFileFor("npx", "win32")).toBe("npx.cmd");
    expect(spawn).toHaveBeenCalledWith(
      "npx.cmd",
      ["supabase", "migration", "list"],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });
});
