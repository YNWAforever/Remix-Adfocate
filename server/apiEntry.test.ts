// Vercel only dispatches HTTP methods that api/index.ts exports; an unexported method
// returns 405 in production while the Vite dev middleware (full Hono app) still works.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("api/index.ts method exports", () => {
  it("exports every HTTP method used by server/routes", () => {
    const routesDir = join(__dirname, "routes");
    const used = new Set<string>();
    for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
      for (const m of readFileSync(join(routesDir, file), "utf8").matchAll(/\.(get|post|put|patch|delete)\(\s*[`"']/g)) {
        used.add(m[1].toUpperCase());
      }
    }
    const entry = readFileSync(join(__dirname, "..", "api", "index.ts"), "utf8");
    const exported = new Set([...entry.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]));
    expect([...used].filter((m) => !exported.has(m))).toEqual([]);
  });
});
