// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { boundedDeltaCommand, deltaChildEnvironment } from "./delta-child-process";

it("blocks a real promisor-object lazy fetch while the unguarded control reaches only its owned loopback remote", async () => {
  const temporaryRoot = resolve(await mkdtemp(join(tmpdir(), "phase3-offline-git-")));
  if (dirname(temporaryRoot) !== resolve(tmpdir()) || !basename(temporaryRoot).startsWith("phase3-offline-git-")) throw new Error("Owned Git cleanup refused");
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.writeHead(404); response.end("owned offline fixture"); });
  try {
    const config = join(temporaryRoot, "empty-config"), hooks = join(temporaryRoot, "empty-hooks");
    await writeFile(config, "", { flag: "wx" }); await mkdir(hooks);
    const env = { ...deltaChildEnvironment(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: config, GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_COUNT: "0", GIT_NO_LAZY_FETCH: "0", GIT_ALLOW_PROTOCOL: "http", GIT_TERMINAL_PROMPT: "0" };
    const git = (args: readonly string[]) => boundedDeltaCommand("git", args, { env, timeoutMs: 10_000, maximumOutputBytes: 64 * 1024 });
    const setup = async (args: readonly string[]) => { const result = await git(args); expect(result.code, result.stderr).toBe(0); };
    const repository = join(temporaryRoot, "repository");
    await setup(["init", "--quiet", "--initial-branch=main", "--template=", repository]);
    await setup(["-C", repository, "-c", "user.name=Owned Offline Fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`, "commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", "owned offline fixture"]);
    await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned loopback fixture missing");
    await setup(["-C", repository, "config", "core.repositoryformatversion", "1"]);
    await setup(["-C", repository, "config", "extensions.partialClone", "origin"]);
    await setup(["-C", repository, "config", "remote.origin.promisor", "true"]);
    await setup(["-C", repository, "config", "remote.origin.partialclonefilter", "blob:none"]);
    await setup(["-C", repository, "config", "remote.origin.url", `http://127.0.0.1:${address.port}/owned-fixture.git`]);
    const missing = "1234567890abcdef1234567890abcdef12345678";
    const guarded = await git(["--no-lazy-fetch", "-C", repository, "merge-base", "--is-ancestor", missing, "HEAD"]);
    expect(guarded.code).not.toBe(0); expect(guarded.stderr).not.toContain("unknown option"); expect(requests).toBe(0);
    const control = await git(["-C", repository, "merge-base", "--is-ancestor", missing, "HEAD"]);
    expect(control.code).not.toBe(0); expect(requests).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((accept, reject) => {
      if (!server.listening) return accept();
      server.close(error => error ? reject(error) : accept()); server.closeAllConnections();
    });
    await rm(temporaryRoot, { recursive: true });
  }
}, 30_000);
