// Local acceptance evidence only. This never grants application/RLS permissions.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export function durableJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w", 0o600);
  try { writeSync(fd, JSON.stringify(value, (key, v) => key === "client" ? undefined : v) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
}
export class FixtureJournal {
  constructor(path, lineage, caps) {
    if (!caps || Object.values(caps).some(n => !Number.isInteger(n) || n < 0)) throw new Error("B2 journal caps must be explicit nonnegative integers");
    this.path = path; this.lineage = lineage; this.caps = caps; this.entries = []; this.inFlight = new Set();
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try { this.entries = readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)); }
      catch { throw new Error("B2 unresolved truncated journal; read-only reconciliation required"); }
      if (this.entries.some(e => !isDeepStrictEqual(e.lineage, lineage))) throw new Error("B2 journal lineage mismatch");
    }
  }
  append(value) {
    const entry = { ...value, lineage: this.lineage, at: new Date().toISOString() };
    const fd = openSync(this.path, "a", 0o600);
    try { writeSync(fd, JSON.stringify(entry) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    this.entries.push(entry); return entry;
  }
  owned() {
    const tables = {};
    for (const e of this.entries.filter(e => ["success", "observed"].includes(e.state))) {
      for (const [table, ids] of Object.entries(e.ids ?? {})) tables[table] = [...new Set([...(tables[table] ?? []), ...ids])];
    }
    return tables;
  }
  assertReady() {
    const last = new Map(this.entries.filter(e => e.token).map(e => [e.token, e]));
    if ([...last.values()].some(e => e.state === "unknown" || e.state === "intent" && !this.inFlight.has(e.token))) throw new Error("B2 UNKNOWN/unresolved operation; no automatic create/reseed");
  }
  begin(label, reserve = {}, planned = {}) {
    this.assertReady();
    for (const [family, count] of Object.entries(reserve)) {
      if (!(family in this.caps) || !Number.isInteger(count) || count < 0) throw new Error("B2 journal family/scope invalid");
      const used = this.entries.filter(e => e.state === "intent").reduce((n, e) => n + (e.reserve?.[family] ?? 0), 0);
      if (used + count > this.caps[family]) throw new Error(`B2 ${family} reservation cap exceeded`);
    }
    for (const [family, ids] of Object.entries(planned)) {
      if (!(family in this.caps) || ids.length > (reserve[family] ?? 0) || ids.some(id => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("B2 planned exact IDs invalid");
    }
    const token = randomUUID(); this.append({ state: "intent", token, label, reserve, planned }); this.inFlight.add(token); return token;
  }
  finish(token, ids = {}, receipt = {}) {
    const intent = this.entries.find(e => e.token === token && e.state === "intent");
    if (!intent || this.entries.some(e => e.token === token && e.state !== "intent")) throw new Error("B2 operation already settled or unknown");
    this.checkIds(ids); this.append({ state: "success", token, ids, receipt }); this.inFlight.delete(token);
  }
  checkIds(ids) {
    const owned = this.owned();
    for (const [family, values] of Object.entries(ids)) {
      if (!(family in this.caps) || values.some(id => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("B2 success IDs/family invalid");
      if (new Set([...(owned[family] ?? []), ...values]).size > this.caps[family]) throw new Error(`B2 ${family} observed row cap exceeded`);
    }
  }
  observe(ids) { this.checkIds(ids); this.append({ state: "observed", ids }); }
  async perform(label, reserve, operation, planned = {}) {
    const token = this.begin(label, reserve, planned);
    try { const ids = await operation(); this.finish(token, ids ?? {}); return ids; }
    catch (error) { this.append({ state: "unknown", token, reason: "operation_or_receipt_failed; retain reservation and reconcile exact correlation read-only" }); throw error; }
  }
  performSync(label, reserve, operation, planned = {}) {
    const token = this.begin(label, reserve, planned);
    try { const ids = operation(); this.finish(token, ids ?? {}); return ids; }
    catch (error) { this.append({ state: "unknown", token, reason: "operation_or_receipt_failed" }); throw error; }
  }
}

export function transportReceipt(status, body) {
  const text = JSON.stringify(body ?? null);
  // References prove what was returned; they are explicitly not table ownership grants.
  return { status, bodySha256: createHash("sha256").update(text).digest("hex"), returnedUuidReferences: [...new Set(text.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi) ?? [])] };
}
export function journalTransportFetch(delegate, journal, origins) {
  return async (input, init) => {
    const url = new globalThis.URL(input instanceof globalThis.Request ? input.url : String(input));
    if (!origins.includes(url.origin)) throw new Error("B2 transport origin disabled");
    const method = (init?.method ?? (input instanceof globalThis.Request ? input.method : "GET")).toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return delegate(input, init);
    if (["close_due_campaigns", "snapshot_campaign_leaderboards"].includes(url.pathname.split("/").at(-1))) throw new Error("B2 global RPC excluded; pristine acceptance is already retained");
    const token = journal.begin(`${method}:${url.pathname}`, { requests: 1 });
    try {
      const response = await delegate(input, init);
      const body = await response.clone().json().catch(() => null);
      journal.finish(token, {}, transportReceipt(response.status, body)); return response;
    } catch (error) {
      journal.append({ state: "unknown", token, reason: "transport_response_or_durable_receipt_lost" }); throw error;
    }
  };
}
export function journalOwnerSql(delegate, journal, privatePath) {
  return query => {
    const token = journal.begin("owner-sql", { requests: 1 });
    // The exact DDL/statement stays private; public receipts contain only a digest/UUID references.
    durableJson(privatePath(`owner-sql-${token}.private.json`), { lineage: journal.lineage, token, query });
    try { const output = delegate(query); journal.finish(token, {}, transportReceipt(200, output)); return output; }
    catch (error) { journal.append({ state: "unknown", token, reason: "owner_sql_or_receipt_failed" }); throw error; }
  };
}
export async function bindBrowserJournal(context, journal, origins) {
  const requests = new WeakMap(), pending = new Set(); let failure;
  const unknown = token => { requests.delete(token.request); journal.append({state:"unknown",token:token.id,reason:"browser_response_or_receipt_lost"}); };
  await context.route("**/*", async route => {
    const request=route.request(),url=new globalThis.URL(request.url());
    if (!origins.includes(url.origin)) return route.abort();
    if (["GET","HEAD","OPTIONS"].includes(request.method())) return route.continue();
    const token={id:journal.begin(`${request.method()}:${url.pathname}`,{requests:1}),request};requests.set(request,token);
    try { return await route.continue(); } catch(error) { unknown(token); throw error; }
  });
  context.on("response", response => {
    const token=requests.get(response.request()); if(!token)return;requests.delete(token.request);
    const receipt=(async()=>{try{journal.finish(token.id,{},transportReceipt(response.status(),await response.json().catch(()=>null)));}catch(error){failure=error;unknown(token);}})();
    pending.add(receipt);void receipt.finally(()=>pending.delete(receipt));
  });
  context.on("requestfailed", request=>{const token=requests.get(request);if(token)unknown(token);});
  const close=context.close.bind(context);
  context.close=async(...args)=>{await Promise.all(pending);if(failure)throw failure;if(journal.inFlight.size)throw new Error("B2 unresolved browser request before close");journal.assertReady();return close(...args);};
}
