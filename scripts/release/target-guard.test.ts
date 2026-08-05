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

  it("normalizes postgres URLs and project refs before comparing them", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetRef: " Rehearsal-Ref ",
      productionRef: "rehearsal-ref",
    })).toThrow("production project reference");
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgres://operator:secret@PRODUCTION:5432/db/?source=test#fragment",
      productionDatabaseUrl: "postgresql://production/db",
    })).toThrow("production database URL");
  });

  it("requires a full disposable token and rejects malformed database URLs", () => {
    for (const targetRef of ["contest-prod", "locality-prod"]) {
      expect(() => assertDisposableTarget({ ...base, targetRef }))
        .toThrow("disposable target");
    }
    expect(() => assertDisposableTarget({ ...base, targetDatabaseUrl: "not-a-url" }))
      .toThrow("database URL");
  });
});
