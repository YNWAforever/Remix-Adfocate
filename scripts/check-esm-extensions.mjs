// Guard against the ESM-extension footgun that took production down for ~a day.
//
// This project is `"type": "module"`, so Node's production ESM loader REQUIRES
// explicit file extensions on relative imports. Vite and vitest (CI + local dev)
// transparently resolve extensionless relative imports, so neither `tsc` nor the
// test suite catches a missing `.js` — but @vercel/node's runtime crashes at
// module load with `ERR_MODULE_NOT_FOUND`, taking down every `/api/*` route.
//
// This scans the server/ + api/ source (the code bundled into the serverless
// function) for relative import/export specifiers lacking a runtime extension
// and fails with a non-zero exit if any are found. It is wired into `npm run
// build` (so even a direct Vercel build fails fast) and runs as its own CI step.

/* global console, process */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["server", "api"];
const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const IS_TEST = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "fixtures", "__tests__"]);
// Relative imports must resolve to a real file at runtime — Node ESM does not
// add extensions or resolve directory indexes. `.json` is allowed (JSON modules).
const RUNTIME_EXT = /\.(js|mjs|cjs|json)$/;
// Captures the specifier in: `from "./x"`, `} from "../x"`, `import "./x"`,
// `export * from "./x"`, and dynamic `import("./x")`.
const SPECIFIER_RE = /(?:\bfrom\b|\bimport\b)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (SOURCE_EXT.test(name) && !IS_TEST.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  let files;
  try {
    files = walk(join(ROOT, dir), []);
  } catch {
    continue; // dir absent — skip
  }
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return; // skip comments
        for (const match of line.matchAll(SPECIFIER_RE)) {
          const spec = match[1];
          if (!RUNTIME_EXT.test(spec)) {
            violations.push({ file: relative(ROOT, file), line: i + 1, spec });
          }
        }
      });
  }
}

if (violations.length > 0) {
  console.error(
    `\n✖ ESM extension check failed: ${violations.length} relative import(s) without a runtime extension.`,
  );
  console.error(
    "  Node's production ESM loader requires explicit extensions — add `.js` (TypeScript compiles to .js):\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  "${v.spec}"   (should be "${v.spec}.js")`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ ESM extension check passed: all relative imports in server/ + api/ carry a runtime extension.");
