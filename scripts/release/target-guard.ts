export interface TargetGuardInput {
  readonly targetRef: string;
  readonly targetDatabaseUrl: string;
  readonly productionRef: string;
  readonly productionDatabaseUrl: string;
}

function canonicalUrl(value: string, label: "target" | "production") {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`rehearsal refused invalid ${label} database URL`);
  }
  if (!url.hostname || !["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`rehearsal refused invalid ${label} database URL`);
  }
  url.protocol = "postgresql:";
  url.password = "";
  url.username = "";
  url.search = "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "5432") url.port = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function canonicalRef(value: string, label: "target" | "production") {
  const ref = value.trim().toLowerCase();
  if (!ref) throw new Error(`rehearsal refused empty ${label} project reference`);
  return ref;
}

export function assertDisposableTarget(input: TargetGuardInput) {
  const targetRef = canonicalRef(input.targetRef, "target");
  const productionRef = canonicalRef(input.productionRef, "production");
  if (targetRef === productionRef) {
    throw new Error("rehearsal refused production project reference");
  }
  if (
    canonicalUrl(input.targetDatabaseUrl, "target")
    === canonicalUrl(input.productionDatabaseUrl, "production")
  ) {
    throw new Error("rehearsal refused production database URL");
  }
  if (!/(?:^|[-_])(test|rehearsal|branch|local)(?:$|[-_])/.test(targetRef)) {
    throw new Error("target is not explicitly identified as a disposable target");
  }
}
