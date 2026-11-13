// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { verifyDeltaVercelAlias, type DeltaVercelOptions } from "./delta-providers.vercel";
import { deltaFixtureHash as h } from "./delta-release.fixture";

// Synthetic API responses only. No real Vercel request or credential is used.
const A = h("vercel-source").slice(0, 40), B = h("vercel-evidence").slice(0, 40), C = h("vercel-other").slice(0, 40);
const TOKEN = "fixture-private-vercel-value-never-report";
const PROJECT = "prj_fixtureAdfocate", TEAM = "team_fixture", DEPLOYMENT = "dpl_fixtureBinding";
const HOST = "adfocate-2-fixture123-ynwaforevers-projects.vercel.app";
const ALIAS_URL = `https://api.vercel.com/v4/aliases/adfocate-2.vercel.app?projectId=${PROJECT}&teamId=${TEAM}`;
const DEPLOYMENT_URL = `https://api.vercel.com/v13/deployments/${DEPLOYMENT}?withGitRepoInfo=true&teamId=${TEAM}`;
type Row = Record<string, unknown>;
function set(value: unknown, path: string, replacement: unknown) {
  const parts = path.split("."); let current = value as Row;
  for (const part of parts.slice(0, -1)) current = current[part] as Row;
  current[parts.at(-1)!] = replacement;
}
function fixture() {
  const options: DeltaVercelOptions = { token: TOKEN, projectId: PROJECT, teamId: TEAM };
  const allowed = [A, B];
  const alias: Row = { alias: "adfocate-2.vercel.app", projectId: PROJECT, deploymentId: DEPLOYMENT, deployment: { id: DEPLOYMENT, url: HOST } };
  const deployment: Row = { id: DEPLOYMENT, projectId: PROJECT, ownerId: TEAM, team: { id: TEAM }, readyState: "READY", target: "production", url: HOST,
    gitSource: { type: "github", sha: A }, meta: { githubCommitSha: A } };
  let failureAt: "fetch" | "body" | undefined;
  let responseStatus = 200;
  let raw: string | undefined;
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input); expect(init?.method).toBe("GET");
    if (failureAt === "fetch") throw new Error(TOKEN);
    const value = url.includes("/v4/aliases/") ? alias : deployment;
    const response = new Response(raw ?? JSON.stringify(value), { status: responseStatus });
    if (failureAt === "body") vi.spyOn(response, "text").mockRejectedValue(new Error(TOKEN));
    return response;
  });
  const verify = (expected = A) => verifyDeltaVercelAlias(options, allowed, expected, { fetch: fetchMock });
  return { options, allowed, alias, deployment, fetchMock, verify, fail: (source: "fetch" | "body") => { failureAt = source; },
    status: (status: number) => { responseStatus = status; }, raw: (value: string) => { raw = value; } };
}
async function rejected(promise: Promise<unknown>, reason?: string) {
  const failure = await promise.then(() => undefined, failure => failure as Error);
  expect(failure).toBeInstanceOf(Error);
  if (reason) expect(failure!.message).toContain(reason);
  expect(`${failure!.message}\n${failure!.stack}`).not.toContain(TOKEN);
  expect(failure).not.toHaveProperty("cause");
}

describe("authenticated Vercel alias binding with synthetic GET responses", () => {
  it("binds the exact canonical alias to a READY production deployment, project, team and allowed GitHub SHA", async () => {
    const f = fixture();
    expect(await f.verify()).toEqual({ commit: A, deploymentId: DEPLOYMENT, url: `https://${HOST}`, projectId: PROJECT });
    expect(f.fetchMock.mock.calls.map(([url]) => url)).toEqual([ALIAS_URL, DEPLOYMENT_URL]);
    for (const [, init] of f.fetchMock.mock.calls) {
      expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
  });
  it("permits the evidence commit only when independently allowed and equal to GitHub's current deployment", async () => {
    const f = fixture(); set(f.deployment, "gitSource.sha", B); set(f.deployment, "meta.githubCommitSha", B);
    expect((await f.verify(B)).commit).toBe(B); await rejected(f.verify(A), "commit binding");
  });
  it("requires every supplied Git SHA to agree and supports explicit single-source legacy metadata", async () => {
    const f = fixture(); delete f.deployment.gitSource; expect((await f.verify()).commit).toBe(A);
    const gitOnly = fixture(); delete gitOnly.deployment.meta; expect((await gitOnly.verify()).commit).toBe(A);
    const neither = fixture(); delete neither.deployment.gitSource; delete neither.deployment.meta; await rejected(neither.verify(), "commit binding");
  });
  it("accepts the documented public project/team projection while rejecting conflicting private fields", async () => {
    const f = fixture(); delete f.deployment.projectId; delete f.deployment.ownerId; f.deployment.project = { id: PROJECT };
    expect((await f.verify()).projectId).toBe(PROJECT);
    f.deployment.projectId = "prj_other"; await rejected(f.verify(), "project binding");
  });
  it("supports an explicitly pinned personal project without inventing a team policy", async () => {
    const f = fixture(); delete (f.options as { teamId?: string }).teamId; delete f.deployment.team; f.deployment.ownerId = "user_fixture";
    expect((await f.verify()).projectId).toBe(PROJECT);
    expect(String(f.fetchMock.mock.calls[0]![0])).not.toContain("teamId");
  });

  it.each([
    ["alias", "other.vercel.app"], ["projectId", "prj_other"], ["deploymentId", "dpl_other"], ["deployment.id", "dpl_other"],
    ["deployment", null], ["deployment.url", "other.vercel.app"], ["teamId", "team_other"],
    ["redirect", "https://evil.example"], ["redirectStatusCode", 302], ["microfrontends", { defaultApp: { projectId: "prj_other" } }], ["deletedAt", 1],
  ])("rejects canonical alias ambiguity or unsafe routing at %s", async (path, value) => {
    const f = fixture(); set(f.alias, path as string, value); await rejected(f.verify());
    if (!String(path).includes("url")) expect(f.fetchMock.mock.calls).toHaveLength(1);
  });
  it.each([
    ["id", "dpl_other"], ["projectId", "prj_other"], ["project.id", "prj_other"], ["ownerId", "team_other"], ["team.id", "team_other"],
    ["readyState", "BUILDING"], ["readyState", "ERROR"], ["target", "preview"], ["target", null], ["deletedAt", 1], ["softDeletedByRetention", true],
    ["gitSource.type", "gitlab"], ["gitSource.sha", C], ["meta.githubCommitSha", C], ["gitSource.sha", "not-a-sha"],
  ])("rejects deployment identity, state or source mismatch at %s", async (path, value) => {
    const f = fixture(); if (path === "project.id") f.deployment.project = { id: PROJECT };
    set(f.deployment, path as string, value); await rejected(f.verify());
  });
  it("rejects a missing project or team identity instead of accepting an anonymous reduced deployment view", async () => {
    const f = fixture(); delete f.deployment.projectId; await rejected(f.verify(), "project binding");
    const team = fixture(); delete team.deployment.ownerId; delete team.deployment.team; await rejected(team.verify(), "team binding");
  });
  it.each([
    "adfocate-2.vercel.app", "https://adfocate-2-fixture123-ynwaforevers-projects.vercel.app", "evil.example",
    "adfocate-2-fixture123-ynwaforevers-projects.vercel.app.evil.example", "adfocate-2-fixture123-ynwaforevers-projects.vercel.app/other",
    "adfocate-2-fixture123-ynwaforevers-projects.vercel.app:443", "adfocate-2-fixture123-ynwaforevers-projects.vercel.app?secret=x",
  ])("rejects non-immutable or untrusted deployment URL %s", async host => {
    const f = fixture(); f.deployment.url = host; set(f.alias, "deployment.url", host); await rejected(f.verify(), "immutable deployment URL");
  });

  it.each([401, 403, 404, 429, 500])("rejects authenticated HTTP status %s without leaking its body", async status => {
    const f = fixture(); f.status(status); f.raw(TOKEN); await rejected(f.verify(), "HTTP status");
  });
  it.each(["fetch", "body"] as const)("redacts private %s failures", async source => {
    const f = fixture(); f.fail(source); await rejected(f.verify(), source === "fetch" ? "provider read failed" : "body read failed");
  });
  it("rejects malformed and oversized provider JSON without returning provider fields", async () => {
    const bad = fixture(); bad.raw(TOKEN); await rejected(bad.verify(), "provider JSON");
    const huge = fixture(); huge.raw(" ".repeat(2 * 1024 * 1024 + 1)); await rejected(huge.verify(), "body bound");
    const primitive = fixture(); primitive.raw("null"); await rejected(primitive.verify(), "provider object");
  });
  it("bounds a fetch which ignores abort and never settles", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); f.fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
      const pending = rejected(f.verify(), "timeout"); await vi.advanceTimersByTimeAsync(15_001); await pending;
      expect(f.fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("captures token, project, team and allowed commits before the first await", async () => {
    const f = fixture(); const firstFetch = f.fetchMock.getMockImplementation()!;
    f.fetchMock.mockImplementation(async (url, init) => {
      set(f.options, "token", "changed-fixture-value"); set(f.options, "projectId", "prj_other"); set(f.options, "teamId", "team_other");
      f.allowed[0] = C;
      return firstFetch(url, init);
    });
    expect((await f.verify()).commit).toBe(A);
    expect(f.fetchMock.mock.calls.map(([url]) => url)).toEqual([ALIAS_URL, DEPLOYMENT_URL]);
    expect(new Headers(f.fetchMock.mock.calls[1]![1]?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });
  it.each([
    { token: "", projectId: PROJECT, teamId: TEAM }, { token: `${TOKEN}\n`, projectId: PROJECT, teamId: TEAM },
    { token: TOKEN, projectId: "project-slug", teamId: TEAM }, { token: TOKEN, projectId: PROJECT, teamId: "../other" },
  ])("requires independently supplied credentials/project/team before any API call", async options => {
    const f = fixture(); await rejected(verifyDeltaVercelAlias(options, [A], A, { fetch: f.fetchMock })); expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a GitHub commit outside the independent allowed set before reading Vercel", async () => {
    const f = fixture(); await rejected(f.verify(C), "allowed commits"); expect(f.fetchMock).not.toHaveBeenCalled();
  });
});
