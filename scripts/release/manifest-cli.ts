import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildManifest,
  digestManifest,
  parseReleaseManifest,
  validateManifest,
} from "./manifest";

function manifestPath(rootDir: string) {
  return resolve(rootDir, "supabase/release-manifest.json");
}

export async function writeManifest(rootDir: string) {
  const manifest = await buildManifest(rootDir);
  const errors = await validateManifest(manifest, rootDir);
  if (errors.length) throw new Error(errors.join("\n"));

  const target = manifestPath(rootDir);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    });
  }
  return digestManifest(manifest);
}

export async function checkManifest(rootDir: string) {
  const manifest = parseReleaseManifest(
    JSON.parse(await readFile(manifestPath(rootDir), "utf8")),
  );
  const errors = await validateManifest(manifest, rootDir);
  if (errors.length) throw new Error(errors.join("\n"));
  return digestManifest(manifest);
}

async function run(command: string | undefined, rootDir: string) {
  if (command === "write") return writeManifest(rootDir);
  if (command === "check") return checkManifest(rootDir);
  throw new Error("usage: manifest-cli.ts <write|check>");
}

if (process.argv[2] === "write" || process.argv[2] === "check") {
  process.stdout.write(`${await run(process.argv[2], process.cwd())}\n`);
}
