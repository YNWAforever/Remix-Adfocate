import { createHash, randomBytes, randomUUID } from "node:crypto";

export type PublishOwner = Readonly<{ workspaceId: string; creatorId: string }>;
export type PublishActor = PublishOwner & Readonly<{ sessionHash: string }>;
export type PublishBinding = Readonly<{
  /** Absent only for the existing private-growth-draft contract. */
  missionBasis?: Readonly<{kind:"active_mission_fixture"|"active_mission_provider";product:"facebook_login";appId:string;submissionId:string;workItemId:string;approvedVersionId:string;instructionRevision:number;disclosureSha256:string}>;
  draftId: string;
  draftRevision: number;
  assetId: string;
  imageSha256: string;
  captionSha256: string;
  connectionId: string;
  accountSubject: string;
  grantGeneration: number;
  fingerprint: string;
}>;
export type PublishState =
  | "creator_approved"
  | "container_preparing"
  | "provider_processing"
  | "publish_requested"
  | "published"
  | "failed"
  | "outcome_unknown"
  | "cancelled"
  | "invalidated";
export type PublishReceipt = Readonly<{
  containerId?: string;
  mediaId?: string;
  status?: "processing" | "ready" | "published" | "failed" | "unknown";
  code?: "PROVIDER_REJECTED" | "PROVIDER_TIMEOUT" | "INTERRUPTED";
  observedAt?: string;
  sampleOnly?: boolean;
}>;
export type PublishIntent = Readonly<{
  id: string;
  owner: PublishOwner;
  binding: PublishBinding;
  requestId: string;
  state: PublishState;
  version: number;
  receipt: PublishReceipt;
  lateReceipt: PublishReceipt;
  sampleOnly: boolean;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
  retentionUntil: string;
}>;
export type PublishPreviewApproval = Readonly<{
  approvalId: string;
  nonce: string;
  expiresAt: string;
}>;
export type ReservePublishInput = Readonly<{
  approvalId: string;
  nonce: string;
  binding: PublishBinding;
  requestId: string;
}>;
export type TransitionPublishInput = Readonly<{
  intentId: string;
  expectedVersion: number;
  expectedState: PublishState;
  nextState: PublishState;
  fingerprint: string;
  receipt?: PublishReceipt;
  requestId: string;
}>;
export type LatePublishReceiptInput = Readonly<{
  intentId: string;
  requestId: string;
  target: Pick<PublishBinding, "connectionId" | "accountSubject" | "grantGeneration">;
  receipt: PublishReceipt;
}>;
export type PublishTransitionResult = Readonly<{ intent: PublishIntent; applied: boolean }>;
export type PublishCleanupResult = Readonly<{
  approvalsDeleted: number;
  intentsDeleted: number;
  heldUnknown: number;
}>;
export interface PublishRepository {
  issuePreview(actor: PublishActor, binding: PublishBinding): Promise<PublishPreviewApproval>;
  reserve(actor: PublishActor, input: ReservePublishInput): Promise<PublishIntent>;
  transition(owner: PublishOwner, input: TransitionPublishInput): Promise<PublishTransitionResult>;
  getOwned(owner: PublishOwner, intentId: string): Promise<PublishIntent>;
  recordLateReceipt(owner: PublishOwner, input: LatePublishReceiptInput): Promise<PublishIntent>;
  cleanup(owner: PublishOwner, limit?: number): Promise<PublishCleanupResult>;
}
export type PublishErrorCode =
  | "PUBLISH_DISABLED"
  | "PUBLISH_INVALID"
  | "PUBLISH_DENIED"
  | "PUBLISH_STALE"
  | "PUBLISH_APPROVAL_INVALID"
  | "PUBLISH_CONFLICT"
  | "PUBLISH_CAS"
  | "PUBLISH_TRANSITION"
  | "PUBLISH_UNAVAILABLE"
  | "PUBLISH_LIMIT";
export class PublishRepositoryError extends Error {
  constructor(readonly code: PublishErrorCode) {
    super(code);
    this.name = "PublishRepositoryError";
  }
}
export type PublishRpc = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;
export type PublishRepositoryOptions = Readonly<{
  enabled?: boolean;
  now?: () => Date;
  idFactory?: () => string;
  nonceFactory?: () => string;
}>;
export type MemoryPublishSource = Readonly<{
  owner: PublishOwner;
  binding: PublishBinding;
  available: boolean;
  grantExpiresAt: string;
  assetExpiresAt: string;
  sampleOnly: boolean;
}>;

const codes: readonly PublishErrorCode[] = [
  "PUBLISH_DISABLED",
  "PUBLISH_INVALID",
  "PUBLISH_DENIED",
  "PUBLISH_STALE",
  "PUBLISH_APPROVAL_INVALID",
  "PUBLISH_CONFLICT",
  "PUBLISH_CAS",
  "PUBLISH_TRANSITION",
  "PUBLISH_UNAVAILABLE",
  "PUBLISH_LIMIT",
];
const states: readonly PublishState[] = [
  "creator_approved",
  "container_preparing",
  "provider_processing",
  "publish_requested",
  "published",
  "failed",
  "outcome_unknown",
  "cancelled",
  "invalidated",
];
const terminal = new Set<PublishState>(["published", "failed", "cancelled", "invalidated"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const providerId = /^[1-9][0-9]{0,63}$/;
const bindingKeys = [
  "draftId",
  "draftRevision",
  "assetId",
  "imageSha256",
  "captionSha256",
  "connectionId",
  "accountSubject",
  "grantGeneration",
  "fingerprint",
];
type Obj = Record<string, unknown>;
function fail(code: PublishErrorCode): never {
  throw new PublishRepositoryError(code);
}
function object(value: unknown, keys: readonly string[], required = keys): asserts value is Obj {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    Object.values(value).some((v) => v === undefined) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    fail("PUBLISH_INVALID");
}
function matches(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value);
}
function integer(value: unknown, min = 1, max = 2147483647) {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
function date(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function ownerKey(owner: PublishOwner) {
  return `${owner.workspaceId}:${owner.creatorId}`;
}
function validOwner(owner: PublishOwner, session = false) {
  object(
    owner,
    ["workspaceId", "creatorId", "sessionHash"],
    session ? ["workspaceId", "creatorId", "sessionHash"] : ["workspaceId", "creatorId"],
  );
  if (
    !matches(owner.workspaceId, uuid) ||
    !matches(owner.creatorId, uuid) ||
    (session && !matches((owner as PublishActor).sessionHash, hash))
  )
    fail("PUBLISH_INVALID");
}
function validBinding(b: PublishBinding) {
  object(b, [...bindingKeys,"missionBasis"], bindingKeys);
  if(b.missionBasis!==undefined){
    const m=b.missionBasis;
    object(m,["kind","product","appId","submissionId","workItemId","approvedVersionId","instructionRevision","disclosureSha256"]);
    if(!["active_mission_fixture","active_mission_provider"].includes(m.kind)||m.product!=="facebook_login"||!matches(m.appId,providerId)
      ||![m.submissionId,m.workItemId,m.approvedVersionId].every(v=>matches(v,uuid))||m.approvedVersionId!==b.draftId
      ||!integer(m.instructionRevision,0)||!matches(m.disclosureSha256,hash))fail("PUBLISH_INVALID");
  }
  if (
    ![b.draftId, b.assetId, b.connectionId].every((v) => matches(v, uuid)) ||
    ![b.imageSha256, b.captionSha256, b.fingerprint].every((v) => matches(v, hash)) ||
    !integer(b.draftRevision) ||
    !integer(b.grantGeneration) ||
    !matches(b.accountSubject, providerId)
  )
    fail("PUBLISH_INVALID");
}
function validReceipt(r: PublishReceipt, now?: string) {
  object(r, ["containerId", "mediaId", "status", "code", "observedAt", "sampleOnly"], []);
  if (
    (r.containerId !== undefined && !matches(r.containerId, providerId)) ||
    (r.mediaId !== undefined && !matches(r.mediaId, providerId)) ||
    (r.status !== undefined &&
      !["processing", "ready", "published", "failed", "unknown"].includes(r.status)) ||
    (r.code !== undefined &&
      !["PROVIDER_REJECTED", "PROVIDER_TIMEOUT", "INTERRUPTED"].includes(r.code)) ||
    (r.observedAt !== undefined &&
      (!date(r.observedAt) ||
        (now !== undefined && Date.parse(r.observedAt) > Date.parse(now) + 60_000))) ||
    (r.sampleOnly !== undefined && typeof r.sampleOnly !== "boolean")
  )
    fail("PUBLISH_INVALID");
}
function stable(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Obj)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function safeIntent(value: unknown, owner: PublishOwner): PublishIntent {
  try {
    object(value, [
      "id",
      "owner",
      "binding",
      "requestId",
      "state",
      "version",
      "receipt",
      "lateReceipt",
      "sampleOnly",
      "stoppedAt",
      "createdAt",
      "updatedAt",
      "retentionUntil",
    ]);
    const i = value as unknown as PublishIntent;
    object(i.owner, ["workspaceId", "creatorId"]);
    validOwner(i.owner);
    validBinding(i.binding);
    validReceipt(i.receipt);
    validReceipt(i.lateReceipt);
    if (
      ownerKey(i.owner) !== ownerKey(owner) ||
      !matches(i.id, uuid) ||
      !matches(i.requestId, uuid) ||
      !states.includes(i.state) ||
      !integer(i.version) ||
      typeof i.sampleOnly !== "boolean" ||
      ![i.createdAt, i.updatedAt, i.retentionUntil].every(date) ||
      (i.stoppedAt !== null && !date(i.stoppedAt))
    )
      fail("PUBLISH_INVALID");
    return clone(i);
  } catch {
    return fail("PUBLISH_UNAVAILABLE");
  }
}

abstract class PublishRepositoryBase implements PublishRepository {
  constructor(protected readonly options: PublishRepositoryOptions) {}
  protected abstract perform(
    owner: PublishOwner,
    action: string,
    payload: Obj,
    now: string,
  ): Promise<unknown>;
  private start(owner: PublishOwner, session = false) {
    if (this.options.enabled !== true) fail("PUBLISH_DISABLED");
    validOwner(owner, session);
    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("PUBLISH_INVALID");
    return now.toISOString();
  }
  private id() {
    const id = (this.options.idFactory ?? randomUUID)();
    if (!matches(id, uuid)) fail("PUBLISH_INVALID");
    return id;
  }
  async issuePreview(
    actor: PublishActor,
    binding: PublishBinding,
  ): Promise<PublishPreviewApproval> {
    const now = this.start(actor, true);
    validBinding(binding);
    const nonce = (this.options.nonceFactory ?? (() => randomBytes(32).toString("base64url")))();
    if (!matches(nonce, /^[A-Za-z0-9_-]{43,128}$/)) fail("PUBLISH_INVALID");
    const approvalId = this.id();
    const expiresAt = new Date(Date.parse(now) + 300_000).toISOString();
    const result = await this.perform(
      actor,
      "preview",
      { approvalId, nonceHash: sha(nonce), sessionHash: actor.sessionHash, binding, expiresAt },
      now,
    );
    if (
      !result ||
      typeof result !== "object" ||
      (result as Obj).approvalId !== approvalId ||
      (result as Obj).expiresAt !== expiresAt
    )
      fail("PUBLISH_UNAVAILABLE");
    return { approvalId, nonce, expiresAt };
  }
  async reserve(actor: PublishActor, input: ReservePublishInput): Promise<PublishIntent> {
    const now = this.start(actor, true);
    object(input, ["approvalId", "nonce", "binding", "requestId"]);
    validBinding(input.binding);
    if (
      ![input.approvalId, input.requestId].every((v) => matches(v, uuid)) ||
      !matches(input.nonce, /^[A-Za-z0-9_-]{43,128}$/)
    )
      fail("PUBLISH_INVALID");
    return safeIntent(
      await this.perform(
        actor,
        "reserve",
        {
          approvalId: input.approvalId,
          nonceHash: sha(input.nonce),
          sessionHash: actor.sessionHash,
          binding: input.binding,
          requestId: input.requestId,
          intentId: this.id(),
        },
        now,
      ),
      actor,
    );
  }
  async transition(
    owner: PublishOwner,
    input: TransitionPublishInput,
  ): Promise<PublishTransitionResult> {
    const now = this.start(owner);
    object(
      input,
      [
        "intentId",
        "expectedVersion",
        "expectedState",
        "nextState",
        "fingerprint",
        "receipt",
        "requestId",
      ],
      ["intentId", "expectedVersion", "expectedState", "nextState", "fingerprint", "requestId"],
    );
    if (
      ![input.intentId, input.requestId].every((v) => matches(v, uuid)) ||
      !integer(input.expectedVersion) ||
      !states.includes(input.expectedState) ||
      !states.includes(input.nextState) ||
      !matches(input.fingerprint, hash)
    )
      fail("PUBLISH_INVALID");
    validReceipt(input.receipt ?? {}, now);
    const result = await this.perform(
      owner,
      "transition",
      { ...input, receipt: input.receipt ?? {} },
      now,
    );
    if (!result || typeof result !== "object" || typeof (result as Obj).applied !== "boolean")
      fail("PUBLISH_UNAVAILABLE");
    return {
      intent: safeIntent((result as Obj).intent, owner),
      applied: (result as Obj).applied as boolean,
    };
  }
  async getOwned(owner: PublishOwner, intentId: string): Promise<PublishIntent> {
    const now = this.start(owner);
    if (!matches(intentId, uuid)) fail("PUBLISH_INVALID");
    return safeIntent(await this.perform(owner, "get", { intentId }, now), owner);
  }
  async recordLateReceipt(
    owner: PublishOwner,
    input: LatePublishReceiptInput,
  ): Promise<PublishIntent> {
    const now = this.start(owner);
    object(input, ["intentId", "requestId", "target", "receipt"]);
    object(input.target, ["connectionId", "accountSubject", "grantGeneration"]);
    validReceipt(input.receipt, now);
    if (
      ![input.intentId, input.requestId, input.target.connectionId].every((v) =>
        matches(v, uuid),
      ) ||
      !matches(input.target.accountSubject, providerId) ||
      !integer(input.target.grantGeneration)
    )
      fail("PUBLISH_INVALID");
    return safeIntent(await this.perform(owner, "late", { ...input }, now), owner);
  }
  async cleanup(owner: PublishOwner, limit = 100): Promise<PublishCleanupResult> {
    const now = this.start(owner);
    if (!integer(limit, 1, 100)) fail("PUBLISH_INVALID");
    const result = await this.perform(owner, "cleanup", { limit }, now);
    try {
      object(result, ["approvalsDeleted", "intentsDeleted", "heldUnknown"]);
      if (!Object.values(result).every((v) => integer(v, 0))) fail("PUBLISH_INVALID");
    } catch {
      fail("PUBLISH_UNAVAILABLE");
    }
    return result as PublishCleanupResult;
  }
}

type Approval = {
  id: string;
  owner: PublishOwner;
  binding: PublishBinding;
  nonceHash: string;
  sessionHash: string;
  expiresAt: string;
  consumed: boolean;
  invalid: boolean;
};
type Command = { hash: string; intentId: string; action: string };
type PublishClaim = { requestId: string; version: number; containerId: string; claimedAt: string };

/** Synthetic canonical dependencies plus shared atomic state for offline tests only. */
export class MemoryPublishDatabase {
  private owners = new Map<string, string>();
  private sources = new Map<string, MemoryPublishSource>();
  private approvals = new Map<string, Approval>();
  private intents = new Map<string, PublishIntent>();
  private commands = new Map<string, Command>();
  // Internal history, scoped to the intent's immutable owner/target/binding; never caller input or DTO.
  private publishClaims = new Map<string, PublishClaim>();
  private revisions = new Map<string, string>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  setOwner(owner: PublishOwner, status: "active" | "suspended" | "deleted") {
    validOwner(owner);
    this.owners.set(ownerKey(owner), status);
    if (status !== "active") this.invalidate((i) => ownerKey(i.owner) === ownerKey(owner));
    if (status !== "active")
      for (const [id, a] of this.approvals)
        if (ownerKey(a.owner) === ownerKey(owner)) this.approvals.delete(id);
    if (status === "deleted") {
      for (const [id, i] of this.intents)
        if (ownerKey(i.owner) === ownerKey(owner) && terminal.has(i.state)) this.removeIntent(id);
      for (const key of this.sources.keys())
        if (key.startsWith(`${ownerKey(owner)}:`)) this.sources.delete(key);
      for (const key of this.revisions.keys())
        if (key.startsWith(`${ownerKey(owner)}:`)) this.revisions.delete(key);
    }
  }
  setSource(source: MemoryPublishSource) {
    validOwner(source.owner);
    validBinding(source.binding);
    if(source.binding.missionBasis&&source.sampleOnly!==(source.binding.missionBasis.kind==="active_mission_fixture"))fail("PUBLISH_INVALID");
    const key = `${ownerKey(source.owner)}:${source.binding.draftId}`;
    this.sources.set(key, clone(source));
    this.invalidate(
      (i) =>
        ownerKey(i.owner) === ownerKey(source.owner) &&
        i.binding.draftId === source.binding.draftId &&
        (!source.available || stable(i.binding) !== stable(source.binding)),
    );
  }
  private invalidate(
    matchesSource: (item: { owner: PublishOwner; binding: PublishBinding }) => boolean,
  ) {
    for (const a of this.approvals.values()) if (matchesSource(a)) a.invalid = true;
    for (const [id, i] of this.intents)
      if (matchesSource(i) && !terminal.has(i.state) && i.stoppedAt === null) {
        const now = this.now().toISOString();
        this.intents.set(id, {
          ...i,
          state: i.state === "creator_approved" ? "invalidated" : "outcome_unknown",
          stoppedAt: now,
          updatedAt: now,
          version: i.version + 1,
        });
      }
  }
  private authority(owner: PublishOwner, binding: PublishBinding, now: string) {
    const source = this.sources.get(`${ownerKey(owner)}:${binding.draftId}`);
    if (
      !source?.available ||
      stable(source.binding) !== stable(binding) ||
      Date.parse(source.grantExpiresAt) <= Date.parse(now) ||
      Date.parse(source.assetExpiresAt) <= Date.parse(now)
    )
      fail("PUBLISH_STALE");
    return source;
  }
  execute(owner: PublishOwner, action: string, p: Obj, now: string): unknown {
    if (this.owners.get(ownerKey(owner)) !== "active") fail("PUBLISH_DENIED");
    const plainOwner = { workspaceId: owner.workspaceId, creatorId: owner.creatorId };
    if (action === "preview") {
      this.authority(owner, p.binding as PublishBinding, now);
      if (
        this.approvals.has(p.approvalId as string) ||
        [...this.approvals.values()].some((a) => a.nonceHash === p.nonceHash)
      )
        fail("PUBLISH_CONFLICT");
      this.approvals.set(p.approvalId as string, {
        id: p.approvalId as string,
        owner: plainOwner,
        binding: clone(p.binding as PublishBinding),
        nonceHash: p.nonceHash as string,
        sessionHash: p.sessionHash as string,
        expiresAt: p.expiresAt as string,
        consumed: false,
        invalid: false,
      });
      return { approvalId: p.approvalId, expiresAt: p.expiresAt };
    }
    if (action === "cleanup") {
      let approvalsDeleted = 0,
        intentsDeleted = 0,
        heldUnknown = 0;
      for (const [id, a] of this.approvals)
        if (
          ownerKey(a.owner) === ownerKey(owner) &&
          a.expiresAt <= now &&
          approvalsDeleted < (p.limit as number)
        ) {
          this.approvals.delete(id);
          approvalsDeleted++;
        }
      for (const [id, i] of this.intents)
        if (ownerKey(i.owner) === ownerKey(owner) && i.retentionUntil <= now) {
          if (!terminal.has(i.state) && i.state !== "creator_approved") {
            heldUnknown++;
            continue;
          }
          if (intentsDeleted >= (p.limit as number)) continue;
          this.removeIntent(id);
          intentsDeleted++;
        }
      return { approvalsDeleted, intentsDeleted, heldUnknown };
    }
    const key = `${ownerKey(owner)}:${p.requestId}`;
    const fingerprintInput =
      action === "reserve"
        ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== "intentId"))
        : p;
    const digest = sha(stable({ action, payload: fingerprintInput }));
    const previous = this.commands.get(key);
    if (previous && (previous.hash !== digest || previous.action !== action))
      fail("PUBLISH_CONFLICT");
    if (action === "reserve") {
      const b = p.binding as PublishBinding;
      const source = this.authority(owner, b, now);
      if (previous) return clone(this.intents.get(previous.intentId));
      const a = this.approvals.get(p.approvalId as string);
      if (
        !a ||
        ownerKey(a.owner) !== ownerKey(owner) ||
        a.invalid ||
        a.consumed ||
        a.expiresAt <= now ||
        a.nonceHash !== p.nonceHash ||
        a.sessionHash !== p.sessionHash ||
        stable(a.binding) !== stable(b)
      )
        fail("PUBLISH_APPROVAL_INVALID");
      // One publication per approved version, even if app/account changes. Matches SQL uniqueness.
      const revisionKey = `${ownerKey(owner)}:${b.draftId}:${b.draftRevision}`;
      const previousId = this.revisions.get(revisionKey);
      let i = previousId ? this.intents.get(previousId) : undefined;
      if (previousId && !i) fail("PUBLISH_CONFLICT");
      if (i && stable(i.binding) !== stable(b)) fail("PUBLISH_CONFLICT");
      if (!i) {
        i = {
          id: p.intentId as string,
          owner: plainOwner,
          binding: clone(b),
          requestId: p.requestId as string,
          state: "creator_approved",
          version: 1,
          receipt: {},
          lateReceipt: {},
          sampleOnly: source.sampleOnly,
          stoppedAt: null,
          createdAt: now,
          updatedAt: now,
          retentionUntil: new Date(Date.parse(now) + 90 * 86400_000).toISOString(),
        };
        if (this.intents.has(i.id)) fail("PUBLISH_CONFLICT");
        this.intents.set(i.id, i);
        this.revisions.set(revisionKey, i.id);
      }
      this.remember(key, digest, i, action);
      a.consumed = true;
      return clone(i);
    }
    let i = this.intents.get(p.intentId as string);
    if (!i || ownerKey(i.owner) !== ownerKey(owner)) fail("PUBLISH_DENIED");
    if (action === "get") return clone(i);
    if (previous) return action === "transition" ? { intent: clone(i), applied: false } : clone(i);
    const receipt = p.receipt as PublishReceipt;
    const publishClaim = this.publishClaims.get(i.id);
    const hasPublishClaim = Boolean(publishClaim && publishClaim.version <= i.version
      && publishClaim.containerId === i.receipt.containerId);
    let newPublishClaim: PublishClaim | undefined;
    if (receipt.sampleOnly !== undefined && receipt.sampleOnly !== i.sampleOnly)
      fail("PUBLISH_INVALID");
    if (action === "late") {
      const target = p.target as LatePublishReceiptInput["target"];
      if (
        target.connectionId !== i.binding.connectionId ||
        target.accountSubject !== i.binding.accountSubject ||
        target.grantGeneration !== i.binding.grantGeneration
      )
        fail("PUBLISH_CONFLICT");
      if (
        ![
          "container_preparing",
          "provider_processing",
          "publish_requested",
          "outcome_unknown",
          "published",
        ].includes(i.state) ||
        (!receipt.containerId && !receipt.mediaId) || (receipt.mediaId && !hasPublishClaim)
      )
        fail("PUBLISH_TRANSITION");
      this.checkIds(i, receipt);
      i = {
        ...i,
        lateReceipt: { ...i.lateReceipt, ...receipt },
        updatedAt: now,
        version: i.version + 1,
      };
    } else if (action === "transition") {
      if (i.version !== p.expectedVersion || i.state !== p.expectedState) fail("PUBLISH_CAS");
      if (i.binding.fingerprint !== p.fingerprint) fail("PUBLISH_STALE");
      const next = p.nextState as PublishState;
      if (i.stoppedAt !== null) fail("PUBLISH_STALE");
      if (
        (i.state === "creator_approved" && Object.keys(receipt).length > 0) ||
        (["container_preparing", "provider_processing"].includes(i.state) &&
          receipt.mediaId !== undefined) || (receipt.mediaId && !hasPublishClaim)
      )
        fail("PUBLISH_TRANSITION");
      this.checkIds(i, receipt);
      const merged = { ...i.receipt, ...receipt };
      const allowed =
        (i.state === "creator_approved" &&
          ["container_preparing", "cancelled", "invalidated"].includes(next)) ||
        (i.state === "container_preparing" &&
          next === "provider_processing" &&
          !!merged.containerId &&
          ["ready", "processing"].includes(merged.status ?? "")) ||
        (i.state === "provider_processing" &&
          next === "provider_processing" &&
          !!i.receipt.containerId &&
          ["ready", "processing"].includes(merged.status ?? "")) ||
        (i.state === "provider_processing" &&
          next === "publish_requested" &&
          !!i.receipt.containerId &&
          i.receipt.status === "ready" && !publishClaim) ||
        (i.state === "publish_requested" &&
          next === "published" &&
          hasPublishClaim &&
          !!merged.mediaId &&
          merged.status === "published") ||
        (i.state === "outcome_unknown" &&
          next === "published" &&
          hasPublishClaim &&
          !!receipt.mediaId &&
          receipt.mediaId === (i.receipt.mediaId ?? i.lateReceipt.mediaId) &&
          receipt.status === "published") ||
        (["container_preparing", "provider_processing", "publish_requested"].includes(i.state) &&
          next === "outcome_unknown") ||
        (["container_preparing", "provider_processing", "publish_requested"].includes(i.state) &&
          next === "failed" &&
          receipt.code === "PROVIDER_REJECTED");
      if (!allowed) fail("PUBLISH_TRANSITION");
      if (
        ["container_preparing", "publish_requested", "published", "provider_processing"].includes(
          next,
        )
      )
        this.authority(owner, i.binding, now);
      if (next === "publish_requested") newPublishClaim = {
        requestId: p.requestId as string, version: i.version + 1,
        containerId: i.receipt.containerId!, claimedAt: now,
      };
      i = { ...i, state: next, receipt: merged, version: i.version + 1, updatedAt: now };
    } else fail("PUBLISH_INVALID");
    this.remember(key, digest, i, action);
    if (newPublishClaim) this.publishClaims.set(i.id, newPublishClaim);
    this.intents.set(i.id, i);
    return action === "transition" ? { intent: clone(i), applied: true } : clone(i);
  }
  private checkIds(i: PublishIntent, receipt: PublishReceipt) {
    for (const k of ["containerId", "mediaId"] as const) {
      const existing = i.receipt[k] ?? i.lateReceipt[k];
      if (existing && receipt[k] && existing !== receipt[k]) fail("PUBLISH_CONFLICT");
    }
  }
  private removeIntent(id: string) {
    this.intents.delete(id);
    this.publishClaims.delete(id);
    for (const [key, cmd] of this.commands) if (cmd.intentId === id) this.commands.delete(key);
  }
  private remember(key: string, hash: string, i: PublishIntent, action: string) {
    if ([...this.commands.values()].filter((c) => c.intentId === i.id).length >= 256)
      fail("PUBLISH_LIMIT");
    this.commands.set(key, { hash, intentId: i.id, action });
  }
}
export class MemoryPublishRepository extends PublishRepositoryBase {
  private database: MemoryPublishDatabase;
  constructor(options: PublishRepositoryOptions & { database: MemoryPublishDatabase }) {
    super(options);
    this.database = options.database;
  }
  protected async perform(owner: PublishOwner, action: string, payload: Obj, now: string) {
    return this.database.execute(owner, action, payload, now);
  }
}
export class SupabasePublishRepository extends PublishRepositoryBase {
  private rpc: PublishRpc;
  constructor(options: PublishRepositoryOptions & { rpc: PublishRpc }) {
    super(options);
    this.rpc = options.rpc;
  }
  protected async perform(owner: PublishOwner, action: string, payload: Obj, now: string) {
    try {
      return await this.rpc("creator_publish_command", {
        p_workspace: owner.workspaceId,
        p_creator: owner.creatorId,
        p_action: action,
        p_payload: payload,
        p_now: now,
      });
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error ? error.message : null;
      throw new PublishRepositoryError(
        codes.includes(message as PublishErrorCode)
          ? (message as PublishErrorCode)
          : "PUBLISH_UNAVAILABLE",
      );
    }
  }
}
