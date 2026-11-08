// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it.each(["vercel.json", "vercel.pilot.json"])("%s protects only the receipt HTML namespace before JavaScript", async path => {
  const config = JSON.parse(await readFile(path, "utf8"));
  // Evaluate the scoped host rule against an HTML request, without rendering JS.
  const rule = config.headers?.find((row: { source: string }) => row.source === "/integration-deletion/:path*");
  const matches = (pathname: string) => rule && /^\/integration-deletion(?:\/.*)?$/.test(pathname);
  expect(matches(`/integration-deletion/${"a".repeat(32)}`)).toBeTruthy();
  for (const other of ["/", "/login", "/api/me", "/missions", "/integration-deletion-other/a"]) expect(matches(other)).toBeFalsy();
  const headers = new Headers(rule?.headers.map((row: { key: string; value: string }) => [row.key, row.value]));
  const html = new Response("<!doctype html><html><head></head><body></body></html>", { headers });
  expect(html.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(html.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
});
