import { describe, expect, it } from "vitest";
import { IntegrationError, integrationMode, requiredScopes, validateReturnPath, normalizeMetric, validateFile } from "./policy.js";

describe("integration policy", () => {
  it("defaults off and cannot enable mock providers in production", () => {
    expect(integrationMode({})).toBe("disabled");
    expect(integrationMode({NODE_ENV:"production",INTEGRATIONS_ENABLED:"true",INTEGRATIONS_MODE:"mock"})).toBe("disabled");
    expect(integrationMode({NODE_ENV:"test",INTEGRATIONS_ENABLED:"true",INTEGRATIONS_MODE:"live"})).toBe("disabled");
    expect(integrationMode({NODE_ENV:"test",INTEGRATIONS_ENABLED:"true",INTEGRATIONS_MODE:"mock"})).toBe("mock");
  });
  it("requests only the approved two provider scope sets", () => {
    expect(requiredScopes("instagram")).toEqual(["instagram_business_basic","instagram_business_manage_insights"]);
    expect(requiredScopes("google_drive")).toEqual(["https://www.googleapis.com/auth/drive.file"]);
  });
  it("keeps the live pilot identity scope separate from mock consent", () => {
    expect(requiredScopes("google_drive","live_pilot")).toEqual(["https://www.googleapis.com/auth/drive.file","openid"]);
    expect(requiredScopes("google_drive")).not.toContain("openid");
  });
  it("blocks external return URLs and preserves only safe studio routes", () => {
    for (const path of ["//evil.test", "https://evil.test", "/\\evil.test", "/connections%2f%2fevil", "/admin"]) expect(validateReturnPath(path)).toBe("/connections");
    expect(validateReturnPath("/studio?thread=abc")).toBe("/studio?thread=abc");
  });
  it("distinguishes missing data from genuine zero and refuses negative/nonfinite metrics", () => {
    expect(normalizeMetric(undefined)).toMatchObject({value:null,availability:"missing"});
    expect(normalizeMetric(0)).toMatchObject({value:0,availability:"available"});
    for(const value of [-1,NaN,Infinity,"0"]) expect(normalizeMetric(value).value).toBeNull();
  });
  it("rejects inaccessible, oversized and unsupported selected files", () => {
    const file={mimeType:"text/plain",canDownload:true,sizeBytes:5*1024*1024};
    expect(()=>validateFile(file)).not.toThrow();
    for(const changes of [{sizeBytes:5*1024*1024+1},{canDownload:false},{mimeType:"application/zip"},{mimeType:"application/vnd.google-apps.shortcut"},{sizeBytes:-1}]) expect(()=>validateFile({...file,...changes})).toThrow(IntegrationError);
  });
});
