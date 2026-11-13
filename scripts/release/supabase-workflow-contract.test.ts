import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/supabase.yml", "utf8").replace(/\r\n/g, "\n");

type WorkflowStep = {
  uses?: string;
  run?: string;
  env: Record<string, string>;
  lines: string[];
};

type Scalar = {
  indentation: number;
  index: number;
  value: string;
};

const guardedExecutor =
  'npm run release:execute -- --bundle "$BUNDLE_PATH" --bundle-digest "$BUNDLE_DIGEST" --project-ref "$PROJECT_REF" --approval "$APPROVAL" --apply';
const guardedDeltaExecutor = guardedExecutor.replace("release:execute", "release:delta:execute");
const pinnedClientPull = "docker --host unix:///var/run/docker.sock pull public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108";

function indentation(line: string) {
  return line.length - line.trimStart().length;
}

function mappingBlock(lines: string[], key: string, parentIndentation: number) {
  const header = new RegExp(`^ {${parentIndentation}}${key}:(?:\\s|$)`);
  const start = lines.findIndex((line) => header.test(line));

  if (start === -1) {
    throw new Error(`Missing ${key} mapping at indentation ${parentIndentation}`);
  }

  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === "" || indentation(lines[end]) > parentIndentation)
  ) {
    end += 1;
  }

  return lines.slice(start + 1, end);
}

function directMappingKeys(lines: string[], expectedIndentation: number) {
  const key = new RegExp(`^ {${expectedIndentation}}([A-Za-z_][\\w-]*):`);

  return lines.flatMap((line) => {
    const match = line.match(key);
    return match ? [match[1]] : [];
  });
}

function scalarValues(lines: string[], key: string): Scalar[] {
  const property = new RegExp(`^(\\s*)(?:-\\s+)?${key}:\\s*(.*)$`);

  return lines.flatMap((line, index) => {
    const match = line.match(property);
    return match
      ? [
          {
            indentation: match[1].length,
            index,
            value: match[2],
          },
        ]
      : [];
  });
}

function scalarValue(lines: string[], key: string) {
  const scalars = scalarValues(lines, key);
  expect(scalars).toHaveLength(1);

  const scalar = scalars[0];
  if (!scalar) {
    throw new Error(`Missing ${key}`);
  }

  if (!/^[>|][+-]?$/.test(scalar.value)) {
    return scalar.value;
  }

  const continuation: string[] = [];
  for (const line of lines.slice(scalar.index + 1)) {
    if (line.trim() !== "" && indentation(line) <= scalar.indentation) {
      break;
    }
    if (line.trim() !== "") {
      continuation.push(line.trim());
    }
  }

  return continuation.join(scalar.value.startsWith(">") ? " " : "\n");
}

function stepChunks(lines: string[], itemIndentation: number) {
  const starts = lines.flatMap((line, index) =>
    new RegExp(`^ {${itemIndentation}}-\\s+`).test(line) ? [index] : [],
  );

  return starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length),
  );
}

function stepEnvironment(lines: string[]) {
  const envHeader = lines.findIndex(
    (line) => indentation(line) === 8 && line.trim() === "env:",
  );
  if (envHeader === -1) {
    return {};
  }

  const envLines = lines.slice(envHeader + 1);
  return Object.fromEntries(
    directMappingKeys(envLines, 10).map((key) => [
      key,
      scalarValue(envLines, key),
    ]),
  );
}

function executableSteps(lines: string[]): WorkflowStep[] {
  return stepChunks(lines, 6).map((lines) => {
    const uses = scalarValues(lines, "uses");
    const runs = scalarValues(lines, "run");

    expect(uses.length + runs.length).toBe(1);

    return {
      uses: uses.length === 1 ? scalarValue(lines, "uses") : undefined,
      run: runs.length === 1 ? scalarValue(lines, "run").replace(/\s+/g, " ").trim() : undefined,
      env: stepEnvironment(lines),
      lines,
    };
  });
}

function expectProductionWorkflowContract(candidate: string) {
  const lines = candidate.replace(/\r\n/g, "\n").split("\n");
  const triggers = mappingBlock(lines, "on", 0);
  expect(directMappingKeys(triggers, 2).sort()).toEqual(["workflow_dispatch"]);

  const dispatch = mappingBlock(triggers, "workflow_dispatch", 2);
  const inputs = mappingBlock(dispatch, "inputs", 4);
  expect(directMappingKeys(inputs, 6).sort()).toEqual([
    "approval",
    "bundle_digest",
    "bundle_path",
    "project_ref",
    "release_profile",
  ]);

  const profile = mappingBlock(inputs, "release_profile", 6);
  expect(scalarValue(profile, "type")).toBe("choice");
  expect(scalarValue(profile, "default")).toBe("reviewed-source-range-v1");
  expect(profile.filter(line => line.trim().startsWith("- ")).map(line => line.trim())).toEqual(["- reviewed-source-range-v1", "- phase3-combined62-xp-v1"]);
  const concurrency = mappingBlock(lines, "concurrency", 0);
  expect(scalarValue(concurrency, "group")).toBe("supabase-production-release");
  expect(scalarValue(concurrency, "cancel-in-progress")).toBe("false");
  const jobs = mappingBlock(lines, "jobs", 0);
  expect(directMappingKeys(jobs, 2)).toEqual(["migrate"]);
  const migrate = mappingBlock(jobs, "migrate", 2);
  expect(scalarValue(migrate, "environment")).toBe("production");
  expect(scalarValue(migrate.filter(line => indentation(line) === 4), "if")).toBe("${{ github.repository == 'YNWAforever/Remix-Adfocate' && github.ref == 'refs/heads/main' }}");
  const permissions = mappingBlock(migrate, "permissions", 4);
  expect(directMappingKeys(permissions, 6).sort()).toEqual(["actions", "contents", "deployments"]);
  for (const key of ["actions", "contents", "deployments"]) expect(scalarValue(permissions, key)).toBe("read");

  const steps = executableSteps(mappingBlock(migrate, "steps", 4));
  // Actions expands ${{ }} into the shell source before bash parses it, so dispatch
  // inputs must reach commands through env bindings read as quoted shell variables.
  for (const step of steps) {
    expect(step.run ?? "").not.toContain("${{");
  }
  expect(steps.map((step) => step.uses ?? step.run)).toEqual([
    "actions/checkout@v4",
    "actions/setup-node@v4",
    "npm ci",
    pinnedClientPull,
    guardedExecutor,
    guardedDeltaExecutor,
  ]);
  expect(scalarValue(steps[0].lines, "fetch-depth")).toBe("0");
  expect(scalarValue(steps[3].lines, "if")).toBe("inputs.release_profile == 'phase3-combined62-xp-v1'");
  expect(scalarValue(steps[4].lines, "if")).toBe("inputs.release_profile == 'reviewed-source-range-v1'");
  expect(scalarValue(steps[5].lines, "if")).toBe("inputs.release_profile == 'phase3-combined62-xp-v1'");
  expect(scalarValue(steps[1].lines, "node-version")).toBe('"22"');
  expect(scalarValue(steps[1].lines, "cache")).toBe("npm");
  expect(steps[2].env).toEqual({});
  expect(steps[3].env).toEqual({});
  expect(steps[4].env).toEqual({
    BUNDLE_PATH: '"${{ inputs.bundle_path }}"',
    BUNDLE_DIGEST: '"${{ inputs.bundle_digest }}"',
    PROJECT_REF: '"${{ inputs.project_ref }}"',
    APPROVAL: '"${{ inputs.approval }}"',
    RELEASE_DATABASE_URL: '"${{ secrets.SUPABASE_DB_URL }}"',
    RELEASE_PROJECT_REF: '"${{ vars.SUPABASE_PROJECT_REF }}"',
    RELEASE_APPLICATION_COMMIT: '"${{ github.sha }}"',
  });
  expect(steps[5].env).toEqual({
    BUNDLE_PATH: '"${{ inputs.bundle_path }}"', BUNDLE_DIGEST: '"${{ inputs.bundle_digest }}"',
    PROJECT_REF: '"${{ inputs.project_ref }}"', APPROVAL: '"${{ inputs.approval }}"',
    RELEASE_DATABASE_URL: '"${{ secrets.SUPABASE_DB_URL }}"', RELEASE_PROJECT_REF: '"${{ vars.SUPABASE_PROJECT_REF }}"',
    RELEASE_DELTA_POLICY_JSON: '"${{ vars.PHASE3_DELTA_POLICY_JSON }}"',
    GITHUB_TOKEN: '"${{ github.token }}"', VERCEL_TOKEN: '"${{ secrets.VERCEL_TOKEN }}"',
    VERCEL_AUTOMATION_BYPASS_SECRET: '"${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"',
  });
}

const unsafeMutations = [
  ["unguarded delta mode", workflow.replace("        if: inputs.release_profile == 'phase3-combined62-xp-v1'\n        run: >-", "        run: >-")],
  ["unprotected branch", workflow.replace("github.ref == 'refs/heads/main'", "github.ref != 'refs/heads/main'")],
  ["cancelling an active release", workflow.replace("cancel-in-progress: false", "cancel-in-progress: true")],
  ["unreviewed client image", workflow.replace(pinnedClientPull, "docker pull public.ecr.aws/supabase/postgres:latest")],
  [
    "a scheduled trigger",
    workflow.replace("on:\n", 'on:\n  schedule:\n    - cron: "0 0 * * *"\n'),
  ],
  ["a pull request trigger", workflow.replace("on:\n", "on:\n  pull_request:\n")],
  ["a reusable workflow trigger", workflow.replace("on:\n", "on:\n  workflow_call:\n")],
  [
    "an arbitrary action",
    workflow.replace(
      "      - run: npm ci",
      "      - uses: actions/upload-artifact@v4\n      - run: npm ci",
    ),
  ],
  [
    "a psql write step",
    workflow.replace("      - run: npm ci", "      - run: npm ci\n      - run: psql $DATABASE_URL"),
  ],
  [
    "a dispatch input interpolated into the command",
    workflow.replace('--bundle "$BUNDLE_PATH"', '--bundle "${{ inputs.bundle_path }}"'),
  ],
  [
    "a context expansion in an unrelated command",
    workflow.replace("      - run: npm ci", '      - run: npm ci --userconfig "${{ inputs.approval }}"'),
  ],
  [
    "an indirect write script",
    workflow.replace("      - run: npm ci", "      - run: npm ci\n      - run: npm run maintenance:apply"),
  ],
] as const;

describe("Supabase production workflow", () => {
  it("delegates writes to exactly one explicitly selected guarded executor", () => {
    expectProductionWorkflowContract(workflow);
  });

  it.each(unsafeMutations)("rejects %s", (_name, mutatedWorkflow) => {
    expect(mutatedWorkflow).not.toBe(workflow);
    expect(() => expectProductionWorkflowContract(mutatedWorkflow)).toThrow();
  });
});
