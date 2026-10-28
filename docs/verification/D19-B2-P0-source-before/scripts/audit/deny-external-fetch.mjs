// Test-process preload only. No application feature flag or production behavior change.
import { URL } from "node:url";
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "127.0.0.1" || !["56400","56421","56521"].includes(url.port)) {
    return Promise.reject(new Error("External HTTP disabled for synthetic acceptance"));
  }
  return originalFetch(input,init);
};
