// Test-process preload only. No application feature flag or production behavior change.
import { URL } from "node:url";
import { b2ExecutionContext } from "./local-targets.mjs";
import { FixtureJournal, journalTransportFetch } from "./fixture-journal.mjs";
import process from "node:process";
const selected = b2ExecutionContext();
const origins = selected?.origins ?? ["http://127.0.0.1:56400", "http://127.0.0.1:56421", "http://127.0.0.1:56521"];
const originalFetch=globalThis.fetch;
let journalledFetch;
globalThis.fetch=(input,init)=>{
  const url=new globalThis.URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!origins.includes(url.origin)) {
    return Promise.reject(new Error("External HTTP disabled for synthetic acceptance"));
  }
  const method=(init?.method??(input instanceof globalThis.Request?input.method:"GET")).toUpperCase();
  if (selected && !["GET","HEAD","OPTIONS"].includes(method)) {
    journalledFetch ??= journalTransportFetch(originalFetch, new FixtureJournal(selected.privatePath(`transport-${process.pid}.jsonl`), selected.lineage, {requests:selected.manifest.fixture.transportWriteCapPerProcess}), origins);
    return journalledFetch(input,init);
  }
  return originalFetch(input,init);
};
