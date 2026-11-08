/**
 * OFFLINE ONLY: strings/payloads, no clients, env reads, file writes or execution.
 * Parent verifies the MCP project and approved SQL application before executing.
 * Receipt contract: {phase:'users_created', projectRef, runId,
 *   users:[{alias, authId, email, createdThisRun:true}]} (exactly nine).
 * createdThisRun is an attestation, not proof: SQL also checks exact Auth IDs/emails.
 * Keep the prepared manifest unchanged; persist receipts separately and privately.
 */
import { createHash } from "node:crypto";

export const RUN_ID = "5f694251-c6eb-4f5f-a281-25e91db81c04";
export const PROJECT_REF = "mhkoayftiuojxlrkollf";
export const REQUIRED_SQL_SHA256 = "ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d";
export const MANIFEST_SHA256 = "32e41e0aa7febd55bb75516779bca8ac5ce62e796e28ee3a503e1a9a414aaab1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAFF = ["S-A", "S-O", "S-R", "S-F"];
const CREATORS = ["C-A", "C-P", "C-B"];
const fail = code => { throw new Error(code); };
const hash = text => createHash("sha256").update(text).digest("hex");
const literal = value => "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
const uuidSql = value => `${literal(value)}::uuid`;
const uuidList = values => `ARRAY[${values.map(uuidSql).join(",")}]::uuid[]`;

/** Stable request UUIDs only; application entity IDs must come from real responses. */
export function pilotRequestId(label) {
  if (!/^(grant:S-[AORF]|revoke:S-R|studio:C-(A|P|B):(thread|source-1|source-2|brief))$/.test(label)) fail("UNKNOWN_REQUEST_LABEL");
  const hex = hash(`${RUN_ID}:${label}`).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const text = hex.slice(0, 32).join("");
  return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;
}

function rejectSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|token|credential|authorization|session|api.?key/i.test(key)
      && !(key === "passwordStored" && child === false)) fail("SANITIZED_RECEIPT_REQUIRED");
    rejectSecrets(child);
  }
}

function sqlTransaction(body, label) {
  // Untrusted approval text cannot terminate the PL/pgSQL dollar-quoted body.
  const tag = `$pilot_${hash(body).slice(0, 20)}$`;
  if (body.includes(tag)) fail("SQL_DELIMITER_COLLISION");
  return `-- OFFLINE GENERATED; parent must verify project ${PROJECT_REF} and SQL ${REQUIRED_SQL_SHA256}.
-- ${label}; run ${RUN_ID}. No Auth writes, creator bootstrap, mission join or awards.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO ${tag}
DECLARE outcome jsonb;
BEGIN
${body}
END;
${tag};
COMMIT;
`;
}

export function createAuthPilotFixtures({ manifestText, usersCreated, approvalRef, observedAt }) {
  if (typeof manifestText !== "string" || hash(manifestText) !== MANIFEST_SHA256) fail("PREPARED_MANIFEST_HASH_MISMATCH");
  const manifest = JSON.parse(manifestText);
  if (manifest.runId !== RUN_ID || manifest.projectRef !== PROJECT_REF || manifest.requiresSqlSha256 !== REQUIRED_SQL_SHA256) fail("MANIFEST_TARGET_MISMATCH");
  if (typeof approvalRef !== "string" || !approvalRef.trim() || approvalRef.length > 500 || approvalRef.includes("\0")) fail("EXPLICIT_APPROVAL_REFERENCE_REQUIRED");
  if (typeof observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) fail("STABLE_OBSERVED_AT_REQUIRED");
  let receipt;
  try { receipt = JSON.parse(JSON.stringify(usersCreated)); } catch { fail("INVALID_USERS_RECEIPT"); }
  rejectSecrets(receipt);
  if (receipt?.phase !== "users_created" || receipt.runId !== RUN_ID || receipt.projectRef !== PROJECT_REF
    || !Array.isArray(receipt.users) || receipt.users.length !== 9) fail("EXACT_USERS_CREATED_RECEIPT_REQUIRED");
  const users = new Map(), ids = new Set();
  for (const user of receipt.users) {
    const expected = manifest.accounts.find(account => account.alias === user?.alias);
    if (!expected || users.has(user.alias) || user.email !== expected.email || user.createdThisRun !== true
      || typeof user.authId !== "string" || !UUID.test(user.authId) || ids.has(user.authId)
      || manifest.workspaces.some(workspace => workspace.id === user.authId)) fail("AUTH_IDENTITY_RECEIPT_MISMATCH");
    ids.add(user.authId);
    users.set(user.alias, { ...expected, authId: user.authId });
  }
  const account = alias => users.get(alias) ?? fail("UNKNOWN_ACTOR_ALIAS");
  const workspace = alias => manifest.workspaces.find(row => row.alias === alias) ?? fail("UNKNOWN_WORKSPACE_ALIAS");
  const authIds = manifest.accounts.map(row => account(row.alias).authId);
  const authArray = uuidList(authIds), wsArray = uuidList(manifest.workspaces.map(row => row.id));
  const requestIds = STAFF.map(alias => pilotRequestId(`grant:${alias}`));
  const allRequests = [...requestIds, pilotRequestId("revoke:S-R")];
  const approval = literal(approvalRef.trim());
  const expectedUsers = manifest.accounts.map(row => `(${uuidSql(account(row.alias).authId)},${literal(row.email)})`).join(",\n      ");
  const ownerAndAuth = `  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'EXACT_DB_OWNER_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${RUN_ID}:fixtures',0));
  PERFORM 1 FROM auth.users WHERE id=ANY(${authArray}) FOR KEY SHARE;
  IF (SELECT count(*) FROM (VALUES ${expectedUsers}) e(id,email)
      JOIN auth.users u ON u.id=e.id AND u.email=e.email AND u.email_confirmed_at IS NOT NULL) <> 9
    OR (SELECT count(*) FROM auth.users WHERE lower(email) IN (${manifest.accounts.map(row => literal(row.email)).join(",")})) <> 9
  THEN RAISE EXCEPTION 'EXACT_CONFIRMED_AUTH_IDENTITIES_REQUIRED'; END IF;`;
  const grantCall = (alias, active, revision, requestLabel, reason) => `  outcome := private.bootstrap_staff_access(
    ${uuidSql(account("S-A").authId)},${uuidSql(workspace("A").id)},${uuidSql(account(alias).authId)},
    ${literal(account(alias).role)},${active},${revision},${uuidSql(pilotRequestId(requestLabel))},${literal(reason)},${approval});
  IF outcome->>'userId' IS DISTINCT FROM ${literal(account(alias).authId)}
    OR outcome->>'workspaceId' IS DISTINCT FROM ${literal(workspace("A").id)}
    OR outcome->>'role' IS DISTINCT FROM ${literal(account(alias).role)}
    OR (outcome->>'active')::boolean IS DISTINCT FROM ${active}
    OR (outcome->>'revision')::integer IS DISTINCT FROM ${revision + 1}
  THEN RAISE EXCEPTION 'AUDITED_GRANT_RESULT_MISMATCH'; END IF;`;

  function seedSql() {
    const body = `${ownerAndAuth}
  IF to_regprocedure('public.bootstrap_creator_account(uuid,uuid,text,text,text)') IS NULL
    OR to_regprocedure('private.brand_staff_mission_write_allowed(uuid)') IS NULL
    OR to_regprocedure('private.bootstrap_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text)') IS NULL
  THEN RAISE EXCEPTION 'APPROVED_AUTH_BOUNDARY_SQL_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=ANY(${wsArray}) OR slug IN (${manifest.workspaces.map(row => literal(row.slug)).join(",")}))
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(${authArray}))
    OR EXISTS(SELECT 1 FROM public.staff_users WHERE user_id=ANY(${authArray}) OR email IN (${manifest.accounts.map(row => literal(row.email)).join(",")}))
    OR EXISTS(SELECT 1 FROM public.brand_users WHERE user_id=ANY(${authArray}) OR email IN (${manifest.accounts.map(row => literal(row.email)).join(",")}))
    OR EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=ANY(${authArray}) OR granted_by=ANY(${authArray}))
    OR EXISTS(SELECT 1 FROM public.staff_platform_roles WHERE user_id=ANY(${authArray}) OR granted_by=ANY(${authArray}))
    OR EXISTS(SELECT 1 FROM public.staff_access_audit WHERE user_id=ANY(${authArray}) OR actor_id=ANY(${authArray}) OR request_id=ANY(${uuidList(allRequests)}))
    OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=ANY(${uuidList(allRequests)}))
  THEN RAISE EXCEPTION 'FIXTURE_COLLISION_STOP_NO_UPSERT'; END IF;
  INSERT INTO public.workspaces(id,slug,name,plan,settings) VALUES
    ${manifest.workspaces.map(row => `(${uuidSql(row.id)},${literal(row.slug)},${literal(`KOCmax approved Auth pilot ${row.alias}`)},'starter',jsonb_build_object('auth_pilot_run_id','${RUN_ID}','expires_at',clock_timestamp()+interval '24 hours'))`).join(",\n    ")};
  INSERT INTO public.staff_users(user_id,email,active) VALUES
    ${STAFF.map(alias => `(${uuidSql(account(alias).authId)},${literal(account(alias).email)},true)`).join(",\n    ")};
  INSERT INTO public.brand_users(user_id,workspace_id,email,role,active) VALUES
    ${[...STAFF, "B-A"].map(alias => `(${uuidSql(account(alias).authId)},${uuidSql(workspace("A").id)},${literal(account(alias).email)},'member',true)`).join(",\n    ")};
${STAFF.map(alias => grantCall(alias, true, 0, `grant:${alias}`, `Approved Auth pilot ${RUN_ID}: initial ${alias} scoped role`)).join("\n")}
  IF (SELECT count(*) FROM public.staff_users WHERE user_id=ANY(${authArray}))<>4
    OR (SELECT count(*) FROM public.brand_users WHERE user_id=ANY(${authArray}))<>5
    OR (SELECT count(*) FROM public.staff_workspace_roles WHERE user_id=ANY(${authArray}) AND workspace_id=${uuidSql(workspace("A").id)} AND active AND revision=1)<>4
    OR (SELECT count(*) FROM public.staff_access_audit WHERE request_id=ANY(${uuidList(requestIds)}) AND actor_id=${uuidSql(account("S-A").authId)} AND actor_kind='db_owner_bootstrap' AND approval_ref=${approval})<>4
    OR EXISTS(SELECT 1 FROM public.creators WHERE id=ANY(${authArray}))
    OR EXISTS(SELECT 1 FROM public.point_balances WHERE creator_id=ANY(${authArray}))
    OR EXISTS(SELECT 1 FROM public.earnings_balances WHERE creator_id=ANY(${authArray}))
  THEN RAISE EXCEPTION 'EXACT_SEED_POSTCONDITION_FAILED'; END IF;`;
    return sqlTransaction(body, "Initial seed: 2 workspaces, 4 staff, 5 brand memberships, 4 scoped grants plus audit/receipts");
  }

  function roleRevokeSql() {
    return sqlTransaction(`${ownerAndAuth}
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=${uuidSql(workspace("A").id)} AND slug=${literal(workspace("A").slug)} AND settings->>'auth_pilot_run_id'='${RUN_ID}')
    OR NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=${uuidSql(account("S-A").authId)} AND workspace_id=${uuidSql(workspace("A").id)} AND role='workspace_admin' AND active AND revision=1)
    OR NOT EXISTS(SELECT 1 FROM public.staff_workspace_roles WHERE user_id=${uuidSql(account("S-R").authId)} AND workspace_id=${uuidSql(workspace("A").id)} AND role='reviewer' AND active AND revision=1)
    OR NOT EXISTS(SELECT 1 FROM public.staff_access_audit WHERE request_id=${uuidSql(pilotRequestId("grant:S-R"))} AND user_id=${uuidSql(account("S-R").authId)} AND actor_id=${uuidSql(account("S-A").authId)} AND approval_ref=${approval})
    OR EXISTS(SELECT 1 FROM public.staff_access_commands WHERE request_id=${uuidSql(pilotRequestId("revoke:S-R"))})
  THEN RAISE EXCEPTION 'EXACT_REVIEWER_REVISION_ONE_REQUIRED'; END IF;
${grantCall("S-R", false, 1, "revoke:S-R", `Approved Auth pilot ${RUN_ID}: revoke reviewer for stale-session checks`)}`, "Revoke only S-R revision 1 -> 2; preserve membership to test no fallback");
  }

  const steps = CREATORS.flatMap(alias => ["thread", "source-1", ...(alias === "C-A" ? ["source-2"] : []), "brief"].map(kind => ({ alias, kind, key: `${alias}:${kind}`, requestId: pilotRequestId(`studio:${alias}:${kind}`) })));
  function checkedStudioReceipts(receipts = []) {
    if (!Array.isArray(receipts) || receipts.length > 10) fail("BOUNDED_STUDIO_RECEIPTS_REQUIRED");
    const found = new Map(), entityIds = new Set();
    for (const item of receipts) {
      const step = steps.find(row => row.key === item?.step);
      const result = item?.result;
      if (!step || found.has(step.key) || item.requestId !== step.requestId || !result || !UUID.test(result.id)
        || entityIds.has(result.id) || result.creator_id !== account(step.alias).authId
        || result.workspace_id !== workspace(account(step.alias).workspaceAlias).id) fail("STUDIO_RECEIPT_OWNERSHIP_MISMATCH");
      if (step.kind === "thread" && (!UUID.test(result.conversation_id) || result.revision !== 0)) fail("INVALID_THREAD_RECEIPT");
      if (step.kind.startsWith("source") && (result.kind !== "manual" || result.shareable !== false || result.status !== "unverified" || result.integration != null || result.revoked_at != null)) fail("PRIVATE_MANUAL_SOURCE_REQUIRED");
      if (step.kind === "brief" && result.version !== 1) fail("FIRST_BRIEF_VERSION_REQUIRED");
      entityIds.add(result.id); found.set(step.key, result);
    }
    for (const step of steps.filter(row => found.has(row.key) && row.kind !== "thread")) {
      const thread = found.get(`${step.alias}:thread`);
      if (!thread || found.get(step.key).thread_id !== thread.id) fail("STUDIO_RECEIPT_THREAD_MISMATCH");
    }
    return found;
  }

  /** Receipts: [{step:'C-A:thread', requestId, result:<POST response.result>}]. */
  function studioRequest(stepKey, receipts = []) {
    const step = steps.find(row => row.key === stepKey);
    if (!step) fail("UNKNOWN_STUDIO_STEP");
    const found = checkedStudioReceipts(receipts), actor = account(step.alias);
    let payload, action;
    if (step.kind === "thread") {
      action = "create_thread";
      payload = { title: `合成權限測試 ${step.alias} · ${RUN_ID}`, topic: "creation", initialPrompt: "本輪合成範例，未經市場驗證；不使用 AI 或外部供應商。" };
    } else {
      const prior = steps.filter(row => row.alias === step.alias);
      if (prior.slice(0, prior.findIndex(row => row.key === step.key)).some(row => !found.has(row.key))) fail("PRIOR_STUDIO_RECEIPTS_REQUIRED");
      const threadId = found.get(`${step.alias}:thread`).id;
      if (step.kind.startsWith("source")) {
        action = "add_source";
        payload = { threadId, revision: step.kind === "source-1" ? 0 : 1, title: `合成訪談題目 ${step.kind}`, content: "香港上班族如何選擇下午茶？此內容只供權限測試，未經驗證。", kind: "manual", shareable: false,
          question: "香港上班族如何選擇下午茶？", platform: "manual", region: "HK", language: "zh-Hant", observed_at: observedAt };
      } else {
        action = "save_brief";
        const sources = prior.filter(row => row.kind.startsWith("source")).map(row => found.get(row.key).id);
        payload = { threadId, revision: sources.length, sections: [{ id: "opening", text: "合成茶飲短片構思；不作健康或市場成效聲稱。", sourceIds: sources }] };
      }
    }
    return { actorAlias: step.alias, method: "POST", path: "/api/studio/commands", headers: { "X-Workspace-Slug": workspace(actor.workspaceAlias).slug }, body: { requestId: step.requestId, action, payload } };
  }

  function cleanupInventorySql(receipts = []) {
    const found = checkedStudioReceipts(receipts);
    const entity = kind => steps.filter(row => (kind === "source" ? row.kind.startsWith(kind) : row.kind === kind) && found.has(row.key)).map(row => found.get(row.key).id);
    const exact = (table, key, values) => `SELECT '${table}' AS relation, ${key} AS id FROM public.${table} WHERE ${key}=ANY(${uuidList(values)})`;
    return `-- READ ONLY inventory; no deletion/anonymisation/Auth actions are generated.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT id,status,workspace_id FROM public.creators WHERE id=ANY(${authArray});
SELECT user_id,active FROM public.staff_users WHERE user_id=ANY(${authArray});
SELECT user_id,workspace_id,role,active FROM public.brand_users WHERE user_id=ANY(${authArray});
SELECT user_id,workspace_id,role,active,revision FROM public.staff_workspace_roles WHERE user_id=ANY(${authArray});
SELECT id,request_id,workspace_id,user_id,actor_id,actor_kind FROM public.staff_access_audit
  WHERE user_id=ANY(${authArray}) OR actor_id=ANY(${authArray}) OR request_id=ANY(${uuidList(allRequests)});
SELECT request_id FROM public.staff_access_commands WHERE request_id=ANY(${uuidList(allRequests)});
${exact("workspaces", "id", manifest.workspaces.map(row => row.id))};
${[ ["studio_threads", entity("thread")], ["studio_sources", entity("source")], ["studio_briefs", entity("brief")] ].map(([table, values]) => `${exact(table, "id", values)} AND creator_id=ANY(${authArray}) AND workspace_id=ANY(${wsArray});`).join("\n")}
SELECT id FROM public.assistant_conversations WHERE id=ANY(${uuidList(steps.filter(row => row.kind === "thread" && found.has(row.key)).map(row => found.get(row.key).conversation_id))}) AND creator_id=ANY(${authArray});
SELECT request_id FROM public.studio_commands WHERE request_id=ANY(${uuidList(steps.map(row => row.requestId))}) AND creator_id=ANY(${authArray}) AND workspace_id=ANY(${wsArray});
SELECT 'point_balances' AS relation,creator_id,workspace_id FROM public.point_balances WHERE creator_id=ANY(${authArray})
UNION ALL SELECT 'earnings_balances',creator_id,workspace_id FROM public.earnings_balances WHERE creator_id=ANY(${authArray});
COMMIT;
`;
  }

  return {
    seedSql, roleRevokeSql, studioRequest, cleanupInventorySql,
    studioSteps: steps.map(row => ({ ...row })),
    scope: { runId: RUN_ID, projectRef: PROJECT_REF, requiredSqlSha256: REQUIRED_SQL_SHA256, manifestSha256: MANIFEST_SHA256,
      workspaces: manifest.workspaces.map(({ alias, id, slug }) => ({ alias, id, slug })),
      accounts: manifest.accounts.map(row => ({ alias: row.alias, authId: account(row.alias).authId, email: row.email })), grantRequestIds: [...requestIds], revokeRequestId: pilotRequestId("revoke:S-R") },
    cleanupPlan: { mode: "INVENTORY_THEN_PRODUCT_ANONYMISATION_AND_AUTH_DISABLE", minimumRetainedAuthAliases: [...STAFF], minimumRetainedWorkspaceIds: [workspace("A").id],
      retain: ["staff_access_audit and staff_access_commands", "their actor/subject Auth identities and workspace parent", "immutable Studio/workflow history and any additional referenced parents"],
      rules: ["Record returned entity/audit IDs; no prefix or broad workspace deletion", "Parent must inspect all remaining references before any deletion", "Use reviewed product anonymisation later; deactivate memberships/grants and ban retained Auth identities", "Verify stale-session denial; never disable FK/immutability guards"],
      exclusions: ["No cleanup mutation SQL", "No account deletion guarantee", "No missions, positive joins, shares, AI, providers or awards in this module"] },
  };
}
