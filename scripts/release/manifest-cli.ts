import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReleaseManifest } from "./contracts";
import { buildManifest, digestManifest, validateManifest } from "./manifest";

const root = process.cwd();
const path = resolve(root, "supabase/release-manifest.json");
const command = process.argv[2];

if (command === "write") {
  const manifest = await buildManifest(root);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${digestManifest(manifest)}\n`);
} else if (command === "check") {
  const manifest = JSON.parse(
    await readFile(path, "utf8"),
  ) as ReleaseManifest;
  const errors = await validateManifest(manifest, root);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`${digestManifest(manifest)}\n`);
} else {
  throw new Error("usage: manifest-cli.ts <write|check>");
}
