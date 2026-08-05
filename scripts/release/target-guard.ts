export interface TargetGuardInput {
  readonly targetRef: string;
  readonly targetDatabaseUrl: string;
  readonly productionRef: string;
  readonly productionDatabaseUrl: string;
}

const SUPABASE_HOST = /(?:^|\.)supabase\.(?:co|com)$/;
const SUPABASE_DIRECT_HOST = /^db\.([a-z0-9-]+)\.supabase\.(?:co|com)$/;
const SUPABASE_POOLER_HOST = /(?:^|\.)pooler\.supabase\.(?:co|com)$/;
const SUPABASE_POOLER_USER = /^postgres\.([a-z0-9-]+)$/;

function parseDatabaseUrl(value: string, label: "target" | "production") {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`rehearsal refused invalid ${label} database URL`);
  }
  if (!url.hostname || !["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`rehearsal refused invalid ${label} database URL`);
  }
  return url;
}

function canonicalUrl(source: URL) {
  const url = new URL(source.href);
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

function username(url: URL) {
  try {
    return decodeURIComponent(url.username).toLowerCase();
  } catch {
    return url.username.toLowerCase();
  }
}

// Supabase serves one database under both db.<ref>.supabase.co and postgres.<ref>@<region>.pooler,
// so URL inequality never proves two projects; the ref carried by the URL itself does.
function urlProjectRef(url: URL) {
  const direct = SUPABASE_DIRECT_HOST.exec(url.hostname.toLowerCase());
  if (direct) return direct[1];
  const pooled = SUPABASE_POOLER_USER.exec(username(url));
  return pooled ? pooled[1] : null;
}

function mentionsRef(url: URL, ref: string) {
  return url.hostname.toLowerCase().includes(ref) || username(url).includes(ref);
}

function canonicalRef(value: string, label: "target" | "production") {
  const ref = value.trim().toLowerCase();
  if (!ref) throw new Error(`rehearsal refused empty ${label} project reference`);
  return ref;
}

export function assertDisposableTarget(input: TargetGuardInput) {
  const targetRef = canonicalRef(input.targetRef, "target");
  const productionRef = canonicalRef(input.productionRef, "production");
  const target = parseDatabaseUrl(input.targetDatabaseUrl, "target");
  const production = parseDatabaseUrl(input.productionDatabaseUrl, "production");
  if (targetRef === productionRef) {
    throw new Error("rehearsal refused production project reference");
  }
  if (canonicalUrl(target) === canonicalUrl(production)) {
    throw new Error("rehearsal refused production database URL");
  }
  const productionUrlRef = urlProjectRef(production);
  if (
    productionUrlRef !== productionRef
    && (productionUrlRef !== null || SUPABASE_HOST.test(production.hostname.toLowerCase()))
  ) {
    throw new Error("production database URL does not identify the production project");
  }
  if (mentionsRef(target, productionRef)) {
    throw new Error("rehearsal refused production database URL");
  }
  const targetUrlRef = urlProjectRef(target);
  if (
    targetUrlRef !== targetRef
    && (targetUrlRef !== null || SUPABASE_HOST.test(target.hostname.toLowerCase()))
  ) {
    throw new Error("target database URL does not identify the target project");
  }
  if (SUPABASE_POOLER_HOST.test(target.hostname.toLowerCase())) {
    throw new Error("rehearsal refused a pooled target database URL");
  }
  if (!/(?:^|[-_])(test|rehearsal|branch|local)(?:$|[-_])/.test(targetRef)) {
    throw new Error("target is not explicitly identified as a disposable target");
  }
}
