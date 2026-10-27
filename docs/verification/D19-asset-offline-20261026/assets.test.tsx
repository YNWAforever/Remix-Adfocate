import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Hono } from "hono";
import { File as BinaryFile } from "node:buffer";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../server/app";
import { createActiveMissionRoutes } from "../../../server/routes/activeMissions";
import type { ActiveMissionRepository } from "../../../server/lib/activeMission/repo";
import { ActiveMissionError } from "../../../server/lib/activeMission/errors";
import * as proof from "../../../server/lib/activeMission/publicationProof";
import * as draft from "../../../server/lib/activeMission/creatorActions";
import { CreatorMissionWorkspace, Route } from "../../../src/routes/_app.my.$submissionId";
import { I18nProvider } from "../../../src/lib/i18n";
import { apiFetch, setWorkspaceSlug } from "../../../src/lib/api";
import type { ActiveMissionWorkspace, MissionPublicationView } from "../../../src/lib/activeMission";

const adapter = vi.hoisted(() => ({ actor: "", sdkCalls: 0, upload: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => { adapter.sdkCalls++; throw new Error("Real SDK forbidden offline"); } }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: adapter.actor, user: { id: adapter.actor } } }, error: null }) },
  storage: { from: (bucket: string) => ({ uploadToSignedUrl: (...args: unknown[]) => adapter.upload(bucket, ...args) }) },
} }));
vi.mock("@tanstack/react-router", async (original) => {
  const actual = await original<typeof import("@tanstack/react-router")>();
  return { ...actual,
    Link: ({ to, children }: { to?: string; children?: ReactNode }) => <a href={to}>{children}</a>,
    useSearch: () => ({ item: "10000000-0000-4000-8000-000000000005" }),
    useNavigate: () => () => undefined,
  };
});

const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const W = "10000000-0000-4000-8000-000000000003", SUB = "10000000-0000-4000-8000-000000000004";
const ITEM = "10000000-0000-4000-8000-000000000005", WF = "10000000-0000-4000-8000-000000000006";
type Obj = Record<string, unknown>;
type Asset = { id: string; storage_object_path: string; upload_state: string; mime_type: string; byte_size: number; content_checksum?: string; checksum?: string; upload_grant_expires_at: string };
let app: Hono<Env>, qc: QueryClient | undefined, rows: Asset[];
let commands: Array<{ name: string; args: Obj }>, requests: Array<{ path: string; method: string; status: number; body: unknown; actor: string }>;
let uploads: Array<{ bucket: string; path: string; bytes: number; sha256: string; upsert: boolean; tokenMatches: boolean }>;
let fault: "none" | "sign" | "sign-and-cleanup" | "upload" | "stale" | "expired" = "none";
let deniedExternalFetches = 0;
const observations: unknown[] = [];
const financialSentinel = Object.freeze({ points: 400, cashAvailable: "47.25", pendingReward: 15, budget: "452.75", ledgerIds: ["existing-memory-ledger"] });

function publication(): MissionPublicationView {
  return {
    workItemId: ITEM, platform: "instagram", state: "approved_to_publish", revision: 4, approvedVersionId: "version-owned",
    instructions: { publicationInstructions: "Publish the approved version.", requiredDisclosures: ["#Ad"], expectedAccount: "@offline",
      proofEvidencePolicy: { required: true }, publishDueAt: "2026-11-01T08:00:00Z", frozenAt: "2026-10-25T08:00:00Z" },
    attempts: [], currentAttempt: null, acceptedAttempt: null,
  };
}
function workspace(): ActiveMissionWorkspace {
  return {
    workflow: { id: WF, submissionId: SUB, state: "drafting", acceptedAt: "2026-10-25T00:00:00Z", deadline: "2026-11-01T00:00:00Z",
      revision: 0, fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48, revisionResponseHours: 48, createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z" },
    mission: { id: "10000000-0000-4000-8000-000000000007", slug: "offline-asset", title: "Offline asset mission", missionType: "ugc",
      brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null, targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] } },
    fulfillment: null,
    workItems: [{ id: ITEM, title: "Owned Reel", platform: "instagram", requirements: [], required: true, position: 1,
      deadline: "2026-11-01T00:00:00Z", state: "approved_to_publish",
      draft: { id: "owned-draft", caption: "Preserved original draft", externalUrl: null, checklist: {}, revision: 2, lastSavedAt: "2026-10-25T00:00:00Z" },
      currentSubmittedVersionId: "version-owned", approvedVersionId: "version-owned", reviewStartedAt: null, reviewDueAt: null }],
    events: [], rewardContract: null, pendingReward: null,
    completionEligibility: { eligible: false, blockers: ["reward_contract_required"], requiredItemCount: 1, verifiedRequiredItemCount: 0 },
    nextAction: { kind: "draft", workItemId: ITEM, deadline: "2026-11-01T00:00:00Z", blockedReason: null },
  };
}
function owned(owner: { creatorId: string; workspaceId: string; submissionId: string }) {
  if (owner.creatorId !== A || owner.workspaceId !== W || owner.submissionId !== SUB) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Active mission not found");
}
const scriptedService = {
  async rpc(name: string, args: Obj) {
    commands.push({ name, args: structuredClone(args) });
    if (name === "create_publication_proof_asset" || name === "create_active_mission_asset") {
      const id = randomUUID();
      const row: Asset = { id, storage_object_path: typeof args.p_storage_object_path === "string" ? args.p_storage_object_path : A + "/" + WF + "/" + ITEM + "/assets/" + id + ".png",
        upload_state: "pending", mime_type: String(args.p_mime_type), byte_size: Number(args.p_byte_size), upload_grant_expires_at: new Date(Date.now() + 600000).toISOString() };
      rows.push(row); return { data: structuredClone(row), error: null };
    }
    if (name.startsWith("abandon_")) {
      if (fault === "sign-and-cleanup") throw new Error("Scripted cleanup unavailable; retain mock pending row");
      rows = rows.filter(x => x.id !== args.p_asset);
      return { data: true, error: null };
    }
    if (name.startsWith("finalize_")) {
      if (fault === "stale") return { data: null, error: { message: "workflow_stale" } };
      if (fault === "expired") return { data: null, error: { message: "upload_grant_expired" } };
      const row = rows.find(x => x.id === args.p_asset)!;
      row.upload_state = name === "finalize_publication_proof_asset" ? "finalized" : "ready";
      row.content_checksum = row.checksum = String(args.p_checksum);
      return { data: structuredClone(row), error: null };
    }
    throw new Error("Unscripted RPC: " + name);
  },
  storage: { from: () => ({ createSignedUploadUrl: async () => fault === "sign" || fault === "sign-and-cleanup"
    ? { data: null, error: { message: "Scripted signing unavailable" } }
    : { data: { token: "offline-only-upload-token" }, error: null } }) },
} as unknown as SupabaseClient;

beforeEach(() => {
  adapter.actor = A; adapter.sdkCalls = 0; fault = "none"; deniedExternalFetches = 0;
  rows = [{ id: "foreign-preexisting-mock", storage_object_path: B + "/foreign.png", upload_state: "ready", mime_type: "image/png", byte_size: 3, upload_grant_expires_at: "2026-11-01T00:00:00Z" }];
  commands = []; requests = []; uploads = [];
  localStorage.clear(); localStorage.setItem("adfocate-lang", "en"); setWorkspaceSlug("offline-asset");
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Route, "useParams").mockReturnValue({ submissionId: SUB } as never);
  const repo: Partial<ActiveMissionRepository> = {
    getWorkspace: async (owner) => { owned(owner); return workspace() as never; },
    getPublication: async (owner) => { owned(owner); return publication() as never; },
    createProofEvidenceUploadGrant: (owner, input, context) => proof.createProofEvidenceUploadGrant(scriptedService, owner, input, context),
    finalizeProofEvidence: (owner, input, context) => proof.finalizeProofEvidence(scriptedService, owner, input, context),
    createUploadGrant: (owner, input) => draft.createUploadGrant(scriptedService, owner, input),
    finalizeAsset: (owner, input) => draft.finalizeAsset(scriptedService, owner, input),
  };
  app = new Hono<Env>();
  app.use("*", async (c, next) => {
    const actor = c.req.header("Authorization")?.slice(7);
    if (![A, B].includes(actor ?? "")) return c.json({ code: "unauthenticated" }, 401);
    if (c.req.header("X-Workspace-Slug") !== "offline-asset") return c.json({ code: "workspace_not_found" }, 404);
    c.set("userId", actor!); c.set("workspaceId", W); c.set("jwt", actor!); await next();
  });
  app.route("/api/my-missions", createActiveMissionRoutes(repo as ActiveMissionRepository));
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (typeof url !== "string" || !url.startsWith("/api/my-missions/")) { deniedExternalFetches++; throw new Error("External or unexpected request forbidden offline"); }
    const result = await app.request(url, init); requests.push({ path: url, method: init?.method ?? "GET", status: result.status,
      body: init?.body ? JSON.parse(String(init.body)) : null, actor: adapter.actor });
    return result;
  });
  adapter.upload.mockReset().mockImplementation(async (bucket: string, path: string, token: string, file: BinaryFile, options: { upsert: boolean }) => {
    const bytes = Buffer.from(await file.arrayBuffer());
    uploads.push({ bucket, path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), upsert: options.upsert, tokenMatches: token === "offline-only-upload-token" });
    if (fault === "upload") return { data: null, error: { message: "Scripted storage unavailable" } };
    return { data: { path }, error: null };
  });
});
afterEach(async (context) => {
  cleanup(); await qc?.cancelQueries(); qc?.clear(); qc = undefined;
  await new Promise(resolve => setTimeout(resolve, 0));
  observations.push({ test: context.task.name, commands, requests, uploads, rows, realSdkClients: adapter.sdkCalls,
    deniedExternalFetches, financialSentinel, financialStateIsScriptedNotRealNeutrality: true });
  if (process.env.ASSET_TRACE) writeFileSync(process.env.ASSET_TRACE, JSON.stringify({
    scope: "Actual Creator route/query/apiFetch/Hono/asset helpers; scripted Auth, repository reads, RPC and Storage only. No real DB, RLS, bytes access, browser or neutrality acceptance.", observations,
  }, null, 2) + "\n");
  expect(adapter.sdkCalls).toBe(0); expect(deniedExternalFetches).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function openProof() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><I18nProvider><CreatorMissionWorkspace /></I18nProvider></QueryClientProvider>);
  await screen.findByRole("heading", { name: "Submit publication proof" });
  fireEvent.change(screen.getByLabelText("Primary public URL"), { target: { value: "https://www.instagram.com/p/offline-owned" } });
}
const choose = (file: BinaryFile) => fireEvent.change(screen.getByLabelText("Add evidence files"), { target: { files: [file] } });
const image = () => new BinaryFile([readFileSync(resolve("docs/verification/D19-asset-offline-20261026/one-pixel.png"))], "offline-proof.png", { type: "image/png" });
const ready = () => screen.getAllByRole("checkbox", { name: "Use offline-proof.png as evidence" }).find(x => !(x as HTMLInputElement).disabled);
const post = (path: string, body: Obj, headers: Obj = {}) => apiFetch(path, { method: "POST", headers: headers as HeadersInit, body: JSON.stringify(body) });
const grantBody = () => ({ fileName: "offline-proof.png", contentType: "image/png", sizeBytes: 8, expectedState: "approved_to_publish", expectedRevision: 4 });
const grantPath = "/my-missions/" + SUB + "/publication/" + ITEM + "/assets/upload-grant";

describe("D19 actual asset UI/API boundary with explicit offline adapters", () => {
  it("uploads actual file bytes through the owner workflow path and finalizes with their SHA256", async () => {
    await openProof(); const file = image(); choose(file);
    await waitFor(() => expect(ready()).toBeDefined());
    expect(uploads).toEqual([{ bucket: "mission-publication-proof-assets", path: expect.stringMatching(new RegExp("^" + A + "/" + WF + "/" + ITEM + "/proof-evidence/")),
      bytes: file.size, sha256: createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex"), upsert: false, tokenMatches: true }]);
    expect(commands.map(c => c.name)).toEqual(["create_publication_proof_asset", "finalize_publication_proof_asset"]);
    expect(commands[0].args).toMatchObject({ p_creator: A, p_workspace: W, p_submission: SUB, p_grant_seconds: 600, p_expected_revision: 4 });
    expect(commands[1].args).toMatchObject({ p_asset: rows[1].id, p_checksum: uploads[0].sha256, p_expected_state: "approved_to_publish", p_expected_revision: 4 });
    expect(rows[1].upload_state).toBe("finalized");
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
  });
  it("rejects MIME and over-limit files before any grant while retaining URL inputs", async () => {
    await openProof();
    choose(new BinaryFile(["bad"], "bad.exe", { type: "application/octet-stream" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("accepted image or video");
    choose(new BinaryFile([new Uint8Array(20971521)], "large.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("20 MB or smaller");
    expect(commands).toEqual([]); expect(uploads).toEqual([]);
    expect(requests.filter(r => r.method !== "GET")).toEqual([]);
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
  });
  it("preserves fields after signing failure, calls exact owned cleanup and allows explicit file reselection", async () => {
    fault = "sign"; await openProof(); choose(image());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t upload");
    expect(commands.map(c => c.name)).toEqual(["create_publication_proof_asset", "abandon_publication_proof_asset"]);
    expect(commands[1].args).toMatchObject({ p_creator: A, p_workspace: W, p_submission: SUB, p_work_item: ITEM, p_storage_object_path: commands[0].args.p_storage_object_path });
    expect(rows.map(r => r.id)).toEqual(["foreign-preexisting-mock"]); expect(uploads).toEqual([]);
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
    fault = "none"; choose(image()); await waitFor(() => expect(ready()).toBeDefined());
    expect(rows[0].id).toBe("foreign-preexisting-mock");
  });
  it("retains the signing error and mock pending receipt if best-effort cleanup also fails", async () => {
    fault = "sign-and-cleanup";
    await expect(post(grantPath, grantBody(), { "Idempotency-Key": randomUUID() })).rejects.toMatchObject({ status: 500, code: "UNKNOWN", message: "Scripted signing unavailable" });
    expect(commands.map(c => c.name)).toEqual(["create_publication_proof_asset", "abandon_publication_proof_asset"]);
    expect(rows).toHaveLength(2); expect(rows[1].upload_state).toBe("pending"); expect(uploads).toEqual([]);
  });
  it("retains the URL after a Storage failure without claiming a finalize or cleanup that did not run", async () => {
    fault = "upload"; await openProof(); choose(image());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t upload");
    expect(commands.map(c => c.name)).toEqual(["create_publication_proof_asset"]); expect(rows[1].upload_state).toBe("pending");
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
    fault = "none"; choose(image()); await waitFor(() => expect(ready()).toBeDefined());
    expect(commands.filter(c => c.name === "finalize_publication_proof_asset")).toHaveLength(1);
  });
  it("shows a failed evidence row and retained inputs when finalize returns an actual route409", async () => {
    fault = "stale"; await openProof(); choose(image());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t upload");
    expect(requests.some(r => r.path.endsWith("/finalize") && r.status === 409)).toBe(true);
    expect(ready()).toBeUndefined(); expect(rows[1].upload_state).toBe("pending");
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
  });
  it("derives Creator, workspace and workflow from trusted route context despite extra spoofed body IDs", async () => {
    await post(grantPath, { ...grantBody(), creatorId: B, workspaceId: "foreign", workflowId: "foreign" }, { "Idempotency-Key": randomUUID() });
    expect(commands[0].args).toMatchObject({ p_creator: A, p_workspace: W, p_submission: SUB, p_work_item: ITEM });
    expect(commands[0].args.p_storage_object_path).toMatch(new RegExp("^" + A + "/" + WF + "/"));
  });
  it("keeps backend MIME and size limits when a caller bypasses the UI", async () => {
    for (const body of [{ ...grantBody(), sizeBytes: 20971521 }, { ...grantBody(), contentType: "application/octet-stream" }]) {
      await expect(post(grantPath, body, { "Idempotency-Key": randomUUID() })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    }
    expect(commands).toEqual([]); expect(uploads).toEqual([]);
  });
  it("preserves inputs on the canonical expiry error and recovers only with a newly selected grant", async () => {
    fault = "expired"; await openProof(); choose(image());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t upload");
    expect(requests.some(r => r.path.endsWith("/finalize") && r.status === 409)).toBe(true);
    expect(ready()).toBeUndefined();
    expect(screen.getByLabelText("Primary public URL")).toHaveValue("https://www.instagram.com/p/offline-owned");
    fault = "none"; choose(image()); await waitFor(() => expect(ready()).toBeDefined());
    expect(commands.filter(c => c.name === "create_publication_proof_asset").map(c => c.args.p_grant_seconds)).toEqual([600, 600]);
    expect(new Set(commands.filter(c => c.name === "create_publication_proof_asset").map(c => c.args.p_idempotency_key)).size).toBe(2);
  });
  it("does not enumerate an A submission or reach asset RPCs for scripted same-workspace Creator B", async () => {
    adapter.actor = B; const headers = { "Idempotency-Key": randomUUID() };
    await expect(post(grantPath, grantBody(), headers)).rejects.toMatchObject({ status: 404, code: "WORKFLOW_NOT_FOUND" });
    await expect(post("/my-missions/" + SUB + "/publication/" + ITEM + "/assets/foreign-asset/finalize", { ...grantBody(), checksum: "hash" }, headers))
      .rejects.toMatchObject({ status: 404, code: "WORKFLOW_NOT_FOUND" });
    expect(commands).toEqual([]); expect(rows.map(r => r.id)).toEqual(["foreign-preexisting-mock"]);
  });
  it("calls exact draft-asset abandonment after signing failure without touching existing mock rows", async () => {
    fault = "sign";
    await expect(post("/my-missions/" + SUB + "/work-items/" + ITEM + "/assets/upload-grant", grantBody()))
      .rejects.toMatchObject({ status: 500, code: "UNKNOWN", message: "Scripted signing unavailable" });
    expect(commands.map(c => c.name)).toEqual(["create_active_mission_asset", "abandon_active_mission_asset"]);
    expect(commands[1].args).toMatchObject({ p_creator: A, p_workspace: W, p_submission: SUB, p_work_item: ITEM });
    expect(commands[1].args.p_asset).toBeTruthy(); expect(commands[1].args.p_storage_object_path).toContain(A + "/" + WF + "/" + ITEM);
    expect(rows.map(r => r.id)).toEqual(["foreign-preexisting-mock"]);
  });
});
