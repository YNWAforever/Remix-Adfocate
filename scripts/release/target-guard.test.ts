import { describe, expect, it } from "vitest";
import { assertDisposableTarget } from "./target-guard";

describe("rehearsal target guard", () => {
  const base = {
    targetRef: "rehearsal-ref",
    targetDatabaseUrl: "postgresql://rehearsal/db",
    productionRef: "mhkoayftiuojxlrkollf",
    productionDatabaseUrl: "postgresql://production/db",
  };

  it("rejects the production ref or production URL", () => {
    expect(() => assertDisposableTarget({ ...base, targetRef: base.productionRef }))
      .toThrow("production project reference");
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: base.productionDatabaseUrl,
    })).toThrow("production database URL");
  });

  it("requires explicit disposable naming", () => {
    expect(() => assertDisposableTarget({ ...base, targetRef: "customer-prod" }))
      .toThrow("disposable target");
    expect(() => assertDisposableTarget(base)).not.toThrow();
  });

  it("compares canonical URLs without accepting credentials as a distinction", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgresql://operator:secret@production/db",
      productionDatabaseUrl: "postgresql://production/db",
    })).toThrow("production database URL");
  });
});
