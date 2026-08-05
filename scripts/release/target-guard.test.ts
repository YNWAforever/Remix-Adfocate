import { describe, expect, it } from "vitest";
import { assertDisposableTarget } from "./target-guard";

describe("rehearsal target guard", () => {
  const base = {
    targetRef: "rehearsal-ref",
    targetDatabaseUrl: "postgresql://rehearsal/db",
    productionRef: "mhkoayftiuojxlrkollf",
    productionDatabaseUrl: "postgresql://production/db",
  };
  const productionDirect = "postgresql://postgres:pw@db.mhkoayftiuojxlrkollf.supabase.co:5432/postgres";
  const productionPooler = "postgresql://postgres.mhkoayftiuojxlrkollf:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

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

  it("rejects the production database reached through a second connection form", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: productionDirect,
      productionDatabaseUrl: productionPooler,
    })).toThrow("production database URL");
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: productionPooler,
      productionDatabaseUrl: productionDirect,
    })).toThrow("production database URL");
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgresql://postgres:pw@mhkoayftiuojxlrkollf.internal.example:5432/postgres",
      productionDatabaseUrl: productionDirect,
    })).toThrow("production database URL");
  });

  it("requires each URL to identify the project reference it is filed under", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgresql://postgres:pw@db.qwertyuiopasdfghjklz.supabase.co:5432/postgres",
      productionDatabaseUrl: productionDirect,
    })).toThrow("target database URL does not identify the target project");
    expect(() => assertDisposableTarget({
      ...base,
      productionDatabaseUrl: "postgresql://postgres:pw@db.qwertyuiopasdfghjklz.supabase.co:5432/postgres",
    })).toThrow("production database URL does not identify the production project");
  });

  it("refuses a pooled connection for a target claimed to be disposable", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgresql://postgres.rehearsal-ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      productionDatabaseUrl: productionDirect,
    })).toThrow("pooled target database URL");
  });

  it("accepts local targets and targets whose URL identifies their own project", () => {
    expect(() => assertDisposableTarget({
      ...base,
      targetRef: "local-empty",
      targetDatabaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      productionDatabaseUrl: productionPooler,
    })).not.toThrow();
    expect(() => assertDisposableTarget({
      ...base,
      targetRef: "local-rehearsal-shape",
      targetDatabaseUrl: "postgresql://postgres:postgres@localhost:54322/postgres",
      productionDatabaseUrl: productionDirect,
    })).not.toThrow();
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: "postgresql://postgres:pw@db.rehearsal-ref.supabase.co:5432/postgres",
      productionDatabaseUrl: productionDirect,
    })).not.toThrow();
  });
});
