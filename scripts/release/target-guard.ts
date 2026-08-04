export interface TargetGuardInput {
  readonly targetRef: string;
  readonly targetDatabaseUrl: string;
  readonly productionRef: string;
  readonly productionDatabaseUrl: string;
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  url.password = "";
  url.username = "";
  return url.toString();
}

export function assertDisposableTarget(input: TargetGuardInput) {
  if (input.targetRef === input.productionRef) {
    throw new Error("rehearsal refused production project reference");
  }
  if (canonicalUrl(input.targetDatabaseUrl) === canonicalUrl(input.productionDatabaseUrl)) {
    throw new Error("rehearsal refused production database URL");
  }
  if (!/(test|rehearsal|branch|local)/i.test(input.targetRef)) {
    throw new Error("target is not explicitly identified as a disposable target");
  }
}
