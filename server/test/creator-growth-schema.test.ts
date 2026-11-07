// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { SupabaseGrowthRepository, type GrowthRpc } from "../lib/creatorGrowth/supabaseRepository.js";
import type { GrowthRouteCommandInput, GrowthRoutePlan } from "../lib/creatorGrowth/repository.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  connect as connectIntegration,
  fixture as integrationFixture,
  rpc as integrationCommand,
  studio as integrationStudio,
} from "./helpers/integrations-fixture.js";

const workspace = "00000000-0000-4000-8000-000000000001";
const otherWorkspace = "00000000-0000-4000-8000-000000000002";
const creator = "00000000-0000-4000-8000-000000000011";
const colleague = "00000000-0000-4000-8000-000000000012";
const otherCreator = "00000000-0000-4000-8000-000000000013";
const brandActor = "00000000-0000-4000-8000-000000000021";
const staffActor = "00000000-0000-4000-8000-000000000031";
const thread = "00000000-0000-4000-8000-000000000041";
const colleagueThread = "00000000-0000-4000-8000-000000000042";
const secondThread = "00000000-0000-4000-8000-000000000043";
const connection = "00000000-0000-4000-8000-000000000051";
const connectionTwo = "00000000-0000-4000-8000-000000000052";
const assetOne = "00000000-0000-4000-8000-000000000061";
const assetTwo = "00000000-0000-4000-8000-000000000062";
const assetThree = "00000000-0000-4000-8000-000000000063";
const assetFour = "00000000-0000-4000-8000-000000000064";
const assetFive = "00000000-0000-4000-8000-000000000065";
const mediaOne = "00000000-0000-4000-8000-000000000071";
const consentOne = "00000000-0000-4000-8000-000000000081";
const analysisOne = "00000000-0000-4000-8000-000000000091";
const skillOne = "00000000-0000-4000-8000-000000000101";
const draftOne = "00000000-0000-4000-8000-000000000111";
const draftTwo = "00000000-0000-4000-8000-000000000112";
const draftThree = "00000000-0000-4000-8000-000000000113";
const now = "2026-12-04T00:00:00.000Z";

let db: PGlite;

type Row = Record<string, unknown>;

async function commandOn(
  database: PGlite,
  action: string,
  payload: Row,
  actor = creator,
  workspaceId = workspace,
  request = crypto.randomUUID(),
) {
  return (
    await database.query<{ result: Row }>(
      "select public.creator_growth_command($1,$2,$3,$4,$5::jsonb) result",
      [workspaceId, actor, request, action, JSON.stringify(payload)],
    )
  ).rows[0].result;
}

async function command(
  action: string,
  payload: Row,
  actor = creator,
  workspaceId = workspace,
  request = crypto.randomUUID(),
) {
  return commandOn(db, action, payload, actor, workspaceId, request);
}

async function denied(run: () => Promise<unknown>, message: string) {
  await db.exec("savepoint denied");
  try {
    await expect(run()).rejects.toThrow(message);
  } finally {
    await db.exec("rollback to savepoint denied; release savepoint denied");
  }
}

async function reserveAsset(id = assetOne, overrides: Row = {}) {
  const response = await command("reserve_asset", {
    id,
    threadId: thread,
    sha256: "a".repeat(64),
    mime: "image/png",
    byteSize: 128,
    width: 640,
    height: 640,
    rightsConfirmed: true,
    sourceKind: "creator-upload",
    sampleOnly: false,
    ...overrides,
  });
  return response.asset as Row;
}

async function confirmAsset(id = assetOne) {
  return command("confirm_asset", { assetId: id });
}

async function revokeCanonicalConnection(
  revokedAt = now,
  connectionId = connection,
) {
  await db.query(
    `update public.integration_connections
     set status='revoked',generation=generation+1,revoked_at=$2
     where id=$1`,
    [connectionId, revokedAt],
  );
}

async function uploadedAsset(id = assetOne, overrides: Row = {}) {
  const reserved = await reserveAsset(id, overrides);
  await confirmAsset(id);
  return reserved;
}

async function mediaSource(overrides: Row = {}) {
  return command("save_media_source", {
    id: mediaOne,
    threadId: thread,
    assetId: assetOne,
    connectionId: connection,
    generation: 1,
    sourceKind: "official_instagram",
    sourceRef: "official-media-1",
    subject: "synthetic-subject",
    mediaId: "123456",
    permalink: "https://www.instagram.com/p/synthetic",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: true,
    observedAt: now,
    fetchedAt: now,
    ...overrides,
  });
}

async function consent() {
  return command("save_consent", {
    id: consentOne,
    processor: "mock-vision",
    consentVersion: "consent-v1",
    grantedAt: "2026-12-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    connectionId: connection,
    generation: 1,
  });
}

async function analysis(overrides: Row = {}, request = crypto.randomUUID()) {
  return command("save_analysis", {
    id: analysisOne,
    threadId: thread,
    mediaSourceId: mediaOne,
    assetId: assetOne,
    consentId: consentOne,
    processor: "mock-vision",
    processorVersion: "v1",
    result: {
      observation: {
        availability: "manual",
        reason: "processing_not_approved",
        objects: [],
        visibleText: [],
        composition: [],
        captionAlignment: "unavailable",
        uncertainties: ["synthetic"],
        sampleOnly: false,
      },
      binding: {
        assetId: assetOne,
        sha256: "a".repeat(64),
        sourceKind: "creator-upload",
      },
    },
    ...overrides,
  }, creator, workspace, request);
}

function evidenceReport(overrides: Row = {}) {
  return {
    question: "Question",
    platform: "instagram",
    runAt: now,
    metrics: [],
    availability: {
      officialMetrics: "unavailable",
      publicImageMock: "not_provided",
      selfUploadManual: "manual",
      reasons: [],
    },
    provenance: {
      officialMetrics: [],
      publicImageMock: null,
      selfUploadManual: {
        sourceKind: "creator-upload",
        manualMode: "creator_upload",
        sourceRef: `asset:${assetOne}`,
        observedAt: now,
        sampleOnly: false,
        assetId: assetOne,
        sha256: "a".repeat(64),
      },
    },
    region: {
      requested: "Hong Kong",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_region_coverage_missing",
    },
    language: {
      requested: "zh-Hant",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_language_coverage_missing",
    },
    period: {
      selection: {
        windowDays: 30,
        mediaLimit: 50,
        appliesTo: "selection_only",
      },
      metrics: [],
    },
    observation: {
      availability: "manual",
      reason: "processing_not_approved",
      sourceKind: "creator-upload",
      sampleOnly: false,
      objects: [],
      visibleText: [],
      composition: [],
      captionAlignment: "unavailable",
      uncertainties: ["synthetic"],
      assetId: assetOne,
      sha256: "a".repeat(64),
    },
    sourcePermission: {
      publicImage: "denied",
      basis: "default_denied",
    },
    partial: true,
    partialReasons: [],
    sampleOnly: false,
    citations: [{
      sourceKind: "self_upload_manual",
      title: "Creator-provided image or manual input",
      sourceRef: `asset:${assetOne}`,
      observedAt: now,
      sampleOnly: false,
    }],
    ...overrides,
  };
}

async function skill(overrides: Row = {}, request = crypto.randomUUID()) {
  const resultOverrides = (overrides.result as Row | undefined) ?? {};
  return command("save_skill_invocation", {
    id: skillOne,
    threadId: thread,
    analysisId: analysisOne,
    mediaSourceIds: [],
    skillId: "next_caption",
    report: evidenceReport(),
    ...overrides,
    result: {
      proposal: "Editable proposal",
      sourceRefs: [`asset:${assetOne}`],
      limitations: ["sample_only"],
      sampleOnly: false,
      ...resultOverrides,
    },
  }, creator, workspace, request);
}

function multiSourceReport() {
  const base = evidenceReport();
  return {
    ...base,
    sampleOnly: true,
    metrics: [{
      metric: "reach",
      value: 84,
      status: "available",
      reason: null,
      sourceRef: "official-two",
      observedAt: now,
      periodKind: "lifetime",
      sampleOnly: true,
    }],
    availability: {
      ...base.availability,
      officialMetrics: "available",
      publicImageMock: "mock",
    },
    provenance: {
      officialMetrics: [
        {
          sourceKind: "official_metrics",
          sourceRef: "official-media-1",
          observedAt: now,
          sampleOnly: true,
          periodKind: "lifetime",
        },
        {
          sourceKind: "official_metrics",
          sourceRef: "official-two",
          observedAt: now,
          sampleOnly: true,
          periodKind: "lifetime",
        },
      ],
      publicImageMock: {
        sourceKind: "public_image_mock",
        sourceRef: "mock-public",
        observedAt: now,
        sampleOnly: true,
        assetId: assetOne,
        sha256: "a".repeat(64),
      },
      selfUploadManual: base.provenance.selfUploadManual,
    },
    period: {
      ...base.period,
      metrics: [{
        metric: "reach",
        kind: "lifetime",
        startAt: null,
        endAt: null,
        sourceRef: "official-media-1",
      }],
    },
    citations: [
      {
        sourceKind: "official_metrics",
        title: "Official A",
        sourceRef: "official-media-1",
        observedAt: now,
        sampleOnly: true,
      },
      {
        sourceKind: "official_metrics",
        title: "Official B",
        sourceRef: "official-two",
        observedAt: now,
        sampleOnly: true,
      },
      {
        sourceKind: "public_image_mock",
        title: "Public mock",
        sourceRef: "mock-public",
        observedAt: now,
        sampleOnly: true,
      },
      ...base.citations,
    ],
  };
}

async function multiSourceSkillContext() {
  await uploadedAsset(assetOne);
  await uploadedAsset(assetTwo);
  await mediaSource();
  const mediaTwo = crypto.randomUUID();
  const mediaThree = crypto.randomUUID();
  await command("save_media_source", {
    id: mediaTwo,
    threadId: thread,
    assetId: assetOne,
    connectionId: connectionTwo,
    generation: 1,
    sourceKind: "official_instagram",
    sourceRef: "official-two",
    subject: "second-official",
    mediaId: "222",
    permalink: "https://www.instagram.com/p/second",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: true,
    observedAt: now,
    fetchedAt: now,
  });
  await command("save_media_source", {
    id: mediaThree,
    threadId: thread,
    assetId: assetOne,
    connectionId: null,
    generation: null,
    sourceKind: "public_image_mock",
    sourceRef: "mock-public",
    subject: "public-match",
    mediaId: "333",
    permalink: "https://www.instagram.com/p/public",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: true,
    observedAt: now,
    fetchedAt: now,
  });
  await consent();
  await analysis();
  return {
    mediaSourceIds: [mediaOne, mediaTwo, mediaThree],
    mediaTwo,
    mediaThree,
    report: multiSourceReport(),
  };
}

async function draft(
  id = draftOne,
  expectedRevision = 0,
  overrides: Row = {},
  request = crypto.randomUUID(),
) {
  return command("save_draft", {
    id,
    threadId: thread,
    assetId: assetOne,
    analysisId: analysisOne,
    skillInvocationId: skillOne,
    expectedRevision,
    caption: "Private draft",
    manualDescription: "Creator description",
    status: "private",
    ...overrides,
  }, creator, workspace, request);
}

async function scalar(sql: string, parameters: unknown[] = []) {
  return (await db.query<{ value: number }>(sql, parameters)).rows[0].value;
}

beforeAll(async () => {
  db = await PGlite.create("memory://");
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create schema storage;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.workspaces(id uuid primary key);
    create table public.creators(
      id uuid primary key,
      workspace_id uuid not null references public.workspaces(id),
      status text not null default 'active',
      constraint integration_creator_workspace_key unique(id,workspace_id)
    );
    create table public.studio_threads(
      id uuid primary key,
      workspace_id uuid not null,
      creator_id uuid not null,
      unique(id,workspace_id,creator_id),
      foreign key(creator_id,workspace_id)
        references public.creators(id,workspace_id) on delete cascade
    );
    create table public.integration_connections(
      id uuid primary key,
      workspace_id uuid not null,
      creator_id uuid not null,
      provider text not null,
      generation integer not null,
      status text not null,
      revoked_at timestamptz,
      unique(id,workspace_id,creator_id),
      foreign key(creator_id,workspace_id)
        references public.creators(id,workspace_id) on delete cascade
    );
    create table public.point_transactions(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null,
      creator_id uuid not null,
      delta integer not null
    );
    create table public.creator_scores(
      workspace_id uuid not null,
      creator_id uuid not null,
      xp integer not null,
      primary key(workspace_id,creator_id)
    );
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      owner_id uuid
    );
    alter table storage.objects enable row level security;

    insert into public.workspaces(id) values
      ('${workspace}'),('${otherWorkspace}');
    insert into public.creators(id,workspace_id,status) values
      ('${creator}','${workspace}','active'),
      ('${colleague}','${workspace}','active'),
      ('${otherCreator}','${otherWorkspace}','active');
    insert into public.studio_threads(id,workspace_id,creator_id) values
      ('${thread}','${workspace}','${creator}'),
      ('${secondThread}','${workspace}','${creator}'),
      ('${colleagueThread}','${workspace}','${colleague}');
    insert into public.integration_connections
      (id,workspace_id,creator_id,provider,generation,status)
    values
      ('${connection}','${workspace}','${creator}','instagram',1,'connected'),
      ('${connectionTwo}','${workspace}','${creator}','instagram',1,'connected');
    insert into public.point_transactions(workspace_id,creator_id,delta)
      values('${workspace}','${creator}',100);
    insert into public.creator_scores(workspace_id,creator_id,xp)
      values('${workspace}','${creator}',250);
  `);
  await db.exec(
    await readFile(
      "supabase/migrations/20261103215321_kocmax_creator_growth_private.sql",
      "utf8",
    ),
  );
}, 30_000);

beforeEach(async () => {
  await db.exec("begin");
});

afterEach(async () => {
  await db.exec("rollback");
});

afterAll(async () => {
  await db.close();
});

describe("creator growth private SQL", () => {
  it("enables RLS, default-denies browser roles, and keeps the bucket private", async () => {
    const tables = [
      "creator_growth_assets",
      "creator_growth_media_sources",
      "creator_growth_consents",
      "creator_growth_analyses",
      "creator_growth_skill_invocations",
      "creator_growth_skill_sources",
      "creator_growth_drafts",
      "creator_growth_events",
      "creator_growth_storage_cleanup",
      "creator_growth_commands",
      "creator_growth_route_commands",
    ];
    const rows = await db.query<{ relation: string; rls: boolean; policies: number }>(`
      select c.relname relation,c.relrowsecurity rls,
        (select count(*)::int from pg_policies p where p.schemaname='private' and p.tablename=c.relname) policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=any($1::text[])
      order by c.relname
    `, [tables]);
    expect(rows.rows).toHaveLength(tables.length);
    expect(rows.rows.every((row) => row.rls && row.policies === 0)).toBe(true);
    for (const table of tables) {
      expect(
        await scalar(`select count(*)::int value from private.${table}`),
      ).toBe(0);
    }
    for (const table of tables) {
      expect(
        await scalar(
          `select case when has_table_privilege('authenticated','private.${table}','SELECT') then 1 else 0 end value`,
        ),
      ).toBe(0);
      expect(
        await scalar(
          `select case when has_table_privilege('service_role','private.${table}','SELECT') then 1 else 0 end value`,
        ),
      ).toBe(0);
    }
    expect(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='creator-growth-private'",
        )
      ).rows[0].public,
    ).toBe(false);
    expect(
      await scalar(`
        select count(*)::int value from information_schema.columns
        where table_schema='private' and table_name like 'creator_growth_%'
          and data_type='bytea'
      `),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int value from pg_policies where schemaname='storage' and tablename='objects' and policyname like '%creator_growth%'",
      ),
    ).toBe(0);
    await db.exec("set local role authenticated");
    await denied(
      () => db.query("select * from private.creator_growth_assets"),
      "permission denied",
    );
    await denied(
      () =>
        db.query(
          "select public.creator_growth_reserve_asset($1,$2,$3,$4::jsonb)",
          [workspace, creator, crypto.randomUUID(), JSON.stringify({})],
        ),
      "permission denied",
    );
    await denied(
      () =>
        db.query(
          "select public.creator_growth_list_cleanup($1,$2,$3)",
          [workspace, creator, crypto.randomUUID()],
        ),
      "permission denied",
    );
    await denied(
      () =>
        db.query(
          `select public.creator_growth_claim_cleanup(
            $1,$2,$3,$4,$5::timestamptz,$6,$7
          )`,
          [
            workspace,
            creator,
            crypto.randomUUID(),
            crypto.randomUUID(),
            now,
            1,
            60,
          ],
        ),
      "permission denied",
    );
    await denied(
      () =>
        db.query(
          `select public.creator_growth_finish_cleanup(
            $1,$2,$3,$4,$5,$6,$7,$8::timestamptz
          )`,
          [
            workspace,
            creator,
            crypto.randomUUID(),
            crypto.randomUUID(),
            crypto.randomUUID(),
            `${workspace}/${creator}/${thread}/${assetOne}.png`,
            "completed",
            now,
          ],
        ),
      "permission denied",
    );
  });

  it("uses composite owner FKs and indexes each real access path without duplicates", async () => {
    const fkDefinitions = (
      await db.query<{ definition: string }>(`
        select pg_get_constraintdef(oid) definition from pg_constraint
        where connamespace='private'::regnamespace and contype='f'
      `)
    ).rows.map((row) => row.definition);
    expect(
      fkDefinitions.some(
        (definition) =>
          definition.includes("workspace_id") &&
          definition.includes("creator_id"),
      ),
    ).toBe(true);
    expect(fkDefinitions.join("\n")).toContain(
      "REFERENCES private.creator_growth_assets(id, thread_id, workspace_id, creator_id)",
    );

    const indexes = (
      await db.query<{ indexname: string; indexdef: string }>(`
        select indexname,indexdef from pg_indexes
        where schemaname='private' and tablename like 'creator_growth_%'
      `)
    ).rows;
    const definitions = indexes.map((index) => index.indexdef);
    expect(definitions.some((definition) =>
      /\(workspace_id, creator_id, thread_id(?:,|\))/.test(definition))).toBe(true);
    expect(definitions.some((definition) =>
      definition.includes("(workspace_id, creator_id, expires_at)"))).toBe(true);
    expect(definitions.some((definition) =>
      /\(workspace_id, creator_id, state, available_at(?:,|\))/.test(definition))).toBe(true);
    expect(
      definitions.filter((definition) =>
        /\(creator_id, workspace_id(?:,|\))/.test(definition),
      ),
    ).toHaveLength(8);
    expect(new Set(definitions).size).toBe(definitions.length);

    const foreignKeys = (
      await db.query<{ table_name: string; columns: string[] }>(`
        select c.conrelid::regclass::text table_name,
          array_agg(a.attname order by keys.ordinality) columns
        from pg_constraint c
        cross join lateral unnest(c.conkey) with ordinality keys(attnum,ordinality)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=keys.attnum
        where c.contype='f' and c.connamespace='private'::regnamespace
        group by c.conname,c.conrelid
      `)
    ).rows;
    const accessPaths = (
      await db.query<{ table_name: string; columns: string[] }>(`
        select i.indrelid::regclass::text table_name,
          array_agg(a.attname order by keys.ordinality) columns
        from pg_index i
        cross join lateral unnest(i.indkey) with ordinality keys(attnum,ordinality)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=keys.attnum
        where i.indrelid in (
          select c.oid from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='private' and c.relname like 'creator_growth_%'
        )
        group by i.indexrelid,i.indrelid
      `)
    ).rows;
    expect(
      foreignKeys.filter((foreignKey) => !accessPaths.some(
        (path) =>
          path.table_name === foreignKey.table_name &&
          foreignKey.columns.every(
            (column, index) => path.columns[index] === column,
          ),
      )),
    ).toEqual([]);
  });

  it("requires an active creator and enforces owner scope for brand, staff, colleague, and cross-workspace calls", async () => {
    const reserved = await reserveAsset();
    expect(reserved.storagePath).toMatch(
      new RegExp(`^${workspace}/${creator}/${thread}/${assetOne}\\.png$`),
    );
    await confirmAsset();
    await db.exec("set local role service_role");
    const serviceResult = (
      await db.query<{ result: Row }>(
        "select public.creator_growth_get_asset($1,$2,$3,$4) result",
        [workspace, creator, crypto.randomUUID(), assetOne],
      )
    ).rows[0].result;
    await db.exec("reset role");
    expect(serviceResult).toMatchObject({
      asset: { id: assetOne, uploadState: "uploaded" },
    });
    expect(
      await command(
        "get_asset",
        { assetId: assetOne },
        colleague,
        workspace,
      ),
    ).toEqual({ asset: null });
    expect(
      await command(
        "get_asset",
        { assetId: assetOne },
        otherCreator,
        otherWorkspace,
      ),
    ).toEqual({ asset: null });
    for (const actor of [brandActor, staffActor]) {
      await denied(
        () => command("reserve_asset", { id: assetTwo }, actor, workspace),
        "NOT_FOUND",
      );
    }
    await db.exec(`update public.creators set status='suspended' where id='${creator}'`);
    await denied(() => reserveAsset(assetThree), "NOT_FOUND");
    await db.exec("set local role service_role");
    await denied(
      () =>
        db.query(
          "select public.creator_growth_reserve_asset($1,$2,$3,$4::jsonb)",
          [
            workspace,
            creator,
            crypto.randomUUID(),
            JSON.stringify({
              id: assetThree,
              threadId: thread,
              sha256: "a".repeat(64),
              mime: "image/png",
              byteSize: 1,
              width: 1,
              height: 1,
              rightsConfirmed: true,
              sourceKind: "creator-upload",
              sampleOnly: false,
            }),
          ],
        ),
      "NOT_FOUND",
    );
  });

  it("generates the object path itself and rejects stale draft revisions", async () => {
    const reserved = await reserveAsset(assetOne, {
      storagePath: `${otherWorkspace}/${otherCreator}/wrong.png`,
    });
    expect(reserved.storagePath).not.toContain("wrong.png");
    await confirmAsset();
    await mediaSource();
    await consent();
    await analysis();
    await skill();
    expect(await draft()).toMatchObject({ id: draftOne, revision: 1 });
    expect(
      await command("get_draft", { draftId: draftOne }, colleague, workspace),
    ).toBeNull();
    expect(
      await command(
        "get_draft",
        { draftId: draftOne },
        otherCreator,
        otherWorkspace,
      ),
    ).toBeNull();
    await denied(() => draft(draftOne, 0), "REVISION_CONFLICT");
    expect(await draft(draftOne, 1)).toMatchObject({ revision: 2 });
  });

  it("requires canonical asset binding and same-thread analysis, skill, and draft lineage", async () => {
    await uploadedAsset(assetOne);
    await mediaSource();
    await consent();
    await denied(
      () => analysis({ assetId: null }),
      "INVALID_INPUT",
    );
    await denied(
      () =>
        analysis({
          result: {
            observation: {
              availability: "manual",
              reason: "processing_not_approved",
              objects: [],
              visibleText: [],
              composition: [],
              captionAlignment: "unavailable",
              uncertainties: ["synthetic"],
              sampleOnly: true,
            },
            binding: {
              assetId: assetOne,
              sha256: "a".repeat(64),
              sourceKind: "synthetic-fixture",
            },
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await analysis();
    await denied(
      () => skill({ threadId: secondThread }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () => skill({ analysisId: null }),
      "INVALID_INPUT",
    );
    await denied(
      () => draft(draftOne, 0, {
        threadId: secondThread,
        analysisId: analysisOne,
        skillInvocationId: null,
      }),
      "SOURCE_INVALIDATED",
    );

    await uploadedAsset(assetTwo, { threadId: secondThread });
    const mediaTwo = "00000000-0000-4000-8000-000000000072";
    await command("save_media_source", {
      id: mediaTwo,
      threadId: secondThread,
      assetId: assetTwo,
      connectionId: connection,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "second-thread-source",
      subject: "synthetic-subject",
      mediaId: "654321",
      permalink: "https://www.instagram.com/p/synthetic-two",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    });
    await denied(
      () => analysis({
        id: "00000000-0000-4000-8000-000000000092",
        mediaSourceId: mediaTwo,
      }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects unusable media sources when attaching them to an analysis", async () => {
    await uploadedAsset(assetOne);
    await uploadedAsset(assetTwo);
    const cases: readonly Readonly<{
      sourceKind: string;
      assetId: string | null;
      connectionId: string | null;
      generation: number | null;
      rights: string;
      visibility: string;
      matchStatus: string;
    }>[] = [
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "denied",
        visibility: "public",
        matchStatus: "matched",
      },
      {
        sourceKind: "creator_upload",
        assetId: assetOne,
        connectionId: null,
        generation: null,
        rights: "unknown",
        visibility: "unknown",
        matchStatus: "unverified",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "private",
        matchStatus: "matched",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "unknown",
        matchStatus: "matched",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "public",
        matchStatus: "unverified",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "public",
        matchStatus: "rejected",
      },
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "allowed",
        visibility: "private",
        matchStatus: "matched",
      },
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "allowed",
        visibility: "public",
        matchStatus: "unverified",
      },
      {
        sourceKind: "creator_upload",
        assetId: assetTwo,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "unknown",
        matchStatus: "unverified",
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      const sourceId = crypto.randomUUID();
      await command("save_media_source", {
        id: sourceId,
        threadId: thread,
        sourceRef: `source-${index}`,
        subject: null,
        mediaId: null,
        permalink: null,
        sampleOnly: true,
        observedAt: now,
        fetchedAt: now,
        ...candidate,
      });
      await denied(
        () =>
          analysis({
            id: crypto.randomUUID(),
            assetId: assetOne,
            mediaSourceId: sourceId,
            consentId: null,
          }),
        "SOURCE_INVALIDATED",
      );
    }
  });

  it("requires the analysis processor to match its consent processor", async () => {
    await uploadedAsset(assetOne);
    await command("save_consent", {
      id: consentOne,
      processor: "different-processor",
      consentVersion: "consent-v1",
      grantedAt: "2026-12-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      connectionId: connection,
      generation: 1,
    });
    await denied(
      () => analysis({ mediaSourceId: null }),
      "SOURCE_INVALIDATED",
    );
  });

  it("requires complete derived-draft analysis and skill lineage", async () => {
    await uploadedAsset(assetOne);
    await uploadedAsset(assetTwo);
    await consent();
    await analysis({ mediaSourceId: null });
    await skill();
    await denied(
      () => draft(draftOne, 0, {
        assetId: null,
        analysisId: analysisOne,
        skillInvocationId: null,
      }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () => draft(draftTwo, 0, {
        assetId: assetOne,
        analysisId: null,
        skillInvocationId: skillOne,
      }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () => draft(draftThree, 0, {
        assetId: assetTwo,
        analysisId: analysisOne,
        skillInvocationId: skillOne,
      }),
      "SOURCE_INVALIDATED",
    );
  });

  it("deletes derived drafts when their upstream analysis is deleted", async () => {
    await uploadedAsset(assetOne);
    await consent();
    await analysis({ mediaSourceId: null });
    await skill();
    await draft(draftOne, 0);
    await db.exec(`delete from private.creator_growth_analyses where id='${analysisOne}'`);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_drafts where id=$1",
        [draftOne],
      ),
    ).toBe(0);
  });

  it("deletes derived drafts when their upstream skill is deleted", async () => {
    await uploadedAsset(assetOne);
    await consent();
    await analysis({ mediaSourceId: null });
    await skill();
    await draft(draftOne, 0);
    await db.exec(`delete from private.creator_growth_skill_invocations where id='${skillOne}'`);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_drafts where id=$1",
        [draftOne],
      ),
    ).toBe(0);
  });

  it("accepts a complete canonical multi-source skill report", async () => {
    const context = await multiSourceSkillContext();
    const saved = await command("save_skill_invocation", {
      id: crypto.randomUUID(),
      threadId: thread,
      analysisId: analysisOne,
      mediaSourceIds: context.mediaSourceIds,
      skillId: "next_caption",
      report: context.report,
      result: {
        proposal: "Editable proposal",
        sourceRefs: [
          "official-media-1",
          "official-two",
          "mock-public",
          `asset:${assetOne}`,
          "native:test",
          "curated:test",
        ],
        limitations: ["sample_only"],
        sampleOnly: true,
      },
    });
    expect(new Set(saved.mediaSourceIds as string[])).toEqual(
      new Set(context.mediaSourceIds),
    );
    const exported = await command("export_owner", {});
    expect(
      new Set(
        (exported.skillInvocations as Row[])[0].mediaSourceIds as string[],
      ),
    ).toEqual(new Set(context.mediaSourceIds));
  });

  it("rejects a public-image report that names another asset", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              publicImageMock: {
                ...context.report.provenance.publicImageMock,
                assetId: assetTwo,
                sha256: "b".repeat(64),
              },
            },
          },
          result: {
            proposal: "Wrong public image",
            sourceRefs: ["mock-public"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects a public-image source bound to another asset", async () => {
    const badPublicSource = crypto.randomUUID();
    await multiSourceSkillContext();
    await command("save_media_source", {
      id: badPublicSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "bad-public",
      subject: "wrong-asset",
      mediaId: "555",
      permalink: "https://www.instagram.com/p/wrong",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    });
    const base = evidenceReport();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: [badPublicSource],
          skillId: "next_caption",
          report: {
            ...base,
            provenance: {
              ...base.provenance,
              publicImageMock: {
                sourceKind: "public_image_mock",
                sourceRef: "bad-public",
                observedAt: now,
                sampleOnly: true,
                assetId: assetOne,
                sha256: "a".repeat(64),
              },
            },
            citations: [
              {
                sourceKind: "public_image_mock",
                title: "Bad public",
                sourceRef: "bad-public",
                observedAt: now,
                sampleOnly: true,
              },
              ...base.citations,
            ],
          },
          result: {
            proposal: "Wrong source asset",
            sourceRefs: ["bad-public", `asset:${assetOne}`],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects a self-upload report with the wrong digest", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              selfUploadManual: {
                ...context.report.provenance.selfUploadManual,
                sha256: "b".repeat(64),
              },
            },
          },
          result: {
            proposal: "Wrong self upload",
            sourceRefs: [`asset:${assetOne}`],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects fake official provenance and result-only source references", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              officialMetrics: [
                ...context.report.provenance.officialMetrics,
                {
                  sourceKind: "official_metrics",
                  sourceRef: "official-fake",
                  observedAt: now,
                  sampleOnly: false,
                  periodKind: "lifetime",
                },
              ],
            },
            citations: [
              ...context.report.citations,
              {
                sourceKind: "official_metrics",
                title: "Fake official",
                sourceRef: "official-fake",
                observedAt: now,
                sampleOnly: false,
              },
            ],
          },
          result: {
            proposal: "Fake provenance",
            sourceRefs: ["official-fake"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: context.report,
          result: {
            proposal: "Fake result ref",
            sourceRefs: ["official-fake"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects provenance without its required citation", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            citations: context.report.citations.filter(
              (citation: Row) => citation.sourceRef !== "official-two",
            ),
          },
          result: {
            proposal: "Missing citation",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("requires a typed observation and consistent sample flags", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: null,
          },
          result: {
            proposal: "Missing observation",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "INVALID_INPUT",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: {
              ...context.report.observation,
              sourceKind: "synthetic-fixture",
              sampleOnly: true,
            },
          },
          result: {
            proposal: "Mislabeled synthetic",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: {
              ...context.report.observation,
              assetId: null,
              sha256: null,
            },
          },
          result: {
            proposal: "Missing binding",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "INVALID_INPUT",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: {
              ...context.report.observation,
              sampleOnly: true,
            },
          },
          result: {
            proposal: "Contradictory observation",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: context.report,
          result: {
            proposal: "Contradictory result",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: false,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            sampleOnly: false,
          },
          result: {
            proposal: "Contradictory report",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("requires normalized equality with every canonical observation field", async () => {
    const context = await multiSourceSkillContext();
    const changes: Row[] = [
      { availability: "observed" },
      { reason: "manual_description_required" },
      { objects: ["object"] },
      { visibleText: ["visible text"] },
      { composition: ["rule of thirds"] },
      { captionAlignment: "aligned" },
      { uncertainties: ["changed"] },
    ];
    for (const change of changes) {
      await denied(
        () =>
          command("save_skill_invocation", {
            id: crypto.randomUUID(),
            threadId: thread,
            analysisId: analysisOne,
            mediaSourceIds: context.mediaSourceIds,
            skillId: "next_caption",
            report: {
              ...context.report,
              observation: {
                ...context.report.observation,
                ...change,
              },
            },
            result: {
              proposal: "Changed observation",
              sourceRefs: ["official-two"],
              limitations: [],
              sampleOnly: true,
            },
          }),
        "SOURCE_INVALIDATED",
      );
    }
    const { reason: _reason, ...missingReason } = context.report.observation;
    void _reason;
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: missingReason,
          },
          result: {
            proposal: "Missing observation field",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "INVALID_INPUT",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            observation: {
              ...context.report.observation,
              extraObservationField: true,
            },
          },
          result: {
            proposal: "Extra observation field",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("matches official and public source sample flags and timestamps", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              officialMetrics: context.report.provenance.officialMetrics.map(
                (entry: Row) =>
                  entry.sourceRef === "official-two"
                    ? { ...entry, sampleOnly: false }
                    : entry,
              ),
            },
          },
          result: {
            proposal: "Wrong official sample",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            citations: context.report.citations.map((entry: Row) =>
              entry.sourceRef === "mock-public"
                ? { ...entry, sampleOnly: false }
                : entry
            ),
          },
          result: {
            proposal: "Wrong public sample",
            sourceRefs: ["mock-public"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              officialMetrics: context.report.provenance.officialMetrics.map(
                (entry: Row) => ({
                  ...entry,
                  observedAt: "2026-11-01T00:00:00Z",
                }),
              ),
            },
          },
          result: {
            proposal: "Wrong official time",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            citations: context.report.citations.map((entry: Row) =>
              entry.sourceRef === "official-media-1"
                ? { ...entry, observedAt: "2026-11-01T00:00:00Z" }
                : entry
            ),
          },
          result: {
            proposal: "Wrong citation time",
            sourceRefs: ["official-media-1"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("requires a canonical source for every available metric", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: context.mediaSourceIds,
          skillId: "next_caption",
          report: {
            ...context.report,
            metrics: [{
              metric: "reach",
              value: 42,
              status: "available",
              reason: null,
              sourceRef: null,
              observedAt: now,
              periodKind: "lifetime",
              sampleOnly: true,
            }],
          },
          result: {
            proposal: "Available without source",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects an unused extra canonical media-source id", async () => {
    const context = await multiSourceSkillContext();
    const unusedSource = crypto.randomUUID();
    await command("save_media_source", {
      id: unusedSource,
      threadId: thread,
      assetId: assetOne,
      connectionId: connectionTwo,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-unused",
      subject: "unused",
      mediaId: "666",
      permalink: "https://www.instagram.com/p/unused",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    });
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: [...context.mediaSourceIds, unusedSource],
          skillId: "next_caption",
          report: context.report,
          result: {
            proposal: "Unused source",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("requires every attached media-source asset to equal the analysis asset", async () => {
    await multiSourceSkillContext();
    const officialSource = crypto.randomUUID();
    const publicSource = crypto.randomUUID();
    await command("save_media_source", {
      id: officialSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: connection,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-wrong-asset",
      subject: "wrong-official",
      mediaId: "777",
      permalink: "https://www.instagram.com/p/wrong-official",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    });
    await command("save_media_source", {
      id: publicSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "public-wrong-asset",
      subject: "wrong-public",
      mediaId: "888",
      permalink: "https://www.instagram.com/p/wrong-public",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    });
    for (const mediaSourceId of [officialSource, publicSource]) {
      await denied(
        () =>
          analysis({
            id: crypto.randomUUID(),
            mediaSourceId,
            consentId: null,
          }),
        "SOURCE_INVALIDATED",
      );
    }
  });

  it("rejects a canonical media source from another thread", async () => {
    const context = await multiSourceSkillContext();
    const crossThreadSource = crypto.randomUUID();
    await uploadedAsset(assetThree, { threadId: secondThread });
    await command("save_media_source", {
      id: crossThreadSource,
      threadId: secondThread,
      assetId: assetThree,
      connectionId: connectionTwo,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-cross-thread",
      subject: "cross-thread",
      mediaId: "444",
      permalink: "https://www.instagram.com/p/cross",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    });
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: [...context.mediaSourceIds, crossThreadSource],
          skillId: "next_caption",
          report: {
            ...context.report,
            provenance: {
              ...context.report.provenance,
              officialMetrics: [{
                sourceKind: "official_metrics",
                sourceRef: "official-cross-thread",
                observedAt: now,
                sampleOnly: true,
                periodKind: "lifetime",
              }],
            },
            citations: [{
              sourceKind: "official_metrics",
              title: "Cross thread",
              sourceRef: "official-cross-thread",
              observedAt: now,
              sampleOnly: true,
            }, ...context.report.citations],
          },
          result: {
            proposal: "Cross thread",
            sourceRefs: ["official-cross-thread"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("rejects duplicate and cross-owner canonical source lists", async () => {
    const context = await multiSourceSkillContext();
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: [
            ...context.mediaSourceIds,
            context.mediaSourceIds[0],
          ],
          skillId: "next_caption",
          report: context.report,
          result: {
            proposal: "Duplicate source",
            sourceRefs: ["official-two"],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );

    const colleagueSource = crypto.randomUUID();
    await command("reserve_asset", {
      id: assetFour,
      threadId: colleagueThread,
      sha256: "a".repeat(64),
      mime: "image/png",
      byteSize: 128,
      width: 640,
      height: 640,
      rightsConfirmed: true,
      sourceKind: "creator-upload",
      sampleOnly: false,
    }, colleague, workspace);
    await command(
      "confirm_asset",
      { assetId: assetFour },
      colleague,
      workspace,
    );
    await command("save_media_source", {
      id: colleagueSource,
      threadId: colleagueThread,
      assetId: assetFour,
      connectionId: null,
      generation: null,
      sourceKind: "creator_upload",
      sourceRef: `asset:${assetFour}`,
      subject: "colleague-source",
      mediaId: null,
      permalink: null,
      rights: "allowed",
      visibility: "unknown",
      matchStatus: "unverified",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    }, colleague, workspace);
    await denied(
      () =>
        command("save_skill_invocation", {
          id: crypto.randomUUID(),
          threadId: thread,
          analysisId: analysisOne,
          mediaSourceIds: [colleagueSource],
          skillId: "next_caption",
          report: evidenceReport(),
          result: {
            proposal: "Cross owner",
            sourceRefs: [`asset:${assetOne}`],
            limitations: [],
            sampleOnly: true,
          },
        }),
      "SOURCE_INVALIDATED",
    );
  });

  it("cascades skill-source links when the skill or media source is deleted", async () => {
    const context = await multiSourceSkillContext();
    const skillId = crypto.randomUUID();
    await command("save_skill_invocation", {
      id: skillId,
      threadId: thread,
      analysisId: analysisOne,
      mediaSourceIds: context.mediaSourceIds,
      skillId: "next_caption",
      report: context.report,
      result: {
        proposal: "Cascade links",
        sourceRefs: ["official-two"],
        limitations: [],
        sampleOnly: true,
      },
    });
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_skill_sources where skill_id=$1",
        [skillId],
      ),
    ).toBe(3);
    await db.exec(
      `delete from private.creator_growth_media_sources where id='${context.mediaThree}'`,
    );
    expect(
      await scalar(
        `select count(*)::int value
         from private.creator_growth_skill_sources
         where skill_id=$1 and media_source_id=$2`,
        [skillId, context.mediaThree],
      ),
    ).toBe(0);
    await db.exec(
      `delete from private.creator_growth_skill_invocations where id='${skillId}'`,
    );
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_skill_sources where skill_id=$1",
        [skillId],
      ),
    ).toBe(0);
  });

  it("invalidates a skill through a linked source while its analysis stays active", async () => {
    const context = await multiSourceSkillContext();
    const skillId = crypto.randomUUID();
    await command("save_skill_invocation", {
      id: skillId,
      threadId: thread,
      analysisId: analysisOne,
      mediaSourceIds: context.mediaSourceIds,
      skillId: "next_caption",
      report: context.report,
      result: {
        proposal: "Linked revocation",
        sourceRefs: ["official-two"],
        limitations: [],
        sampleOnly: true,
      },
    });
    await revokeCanonicalConnection(now, connectionTwo);
    expect(
      (
        await db.query<{
          analysis_invalid: boolean;
          skill_invalid: boolean;
        }>(
          `select
             a.invalidated_at is not null analysis_invalid,
             s.invalidated_at is not null skill_invalid
           from private.creator_growth_analyses a
           join private.creator_growth_skill_invocations s on s.analysis_id=a.id
           where a.id=$1 and s.id=$2`,
          [analysisOne, skillId],
        )
      ).rows[0],
    ).toEqual({
      analysis_invalid: false,
      skill_invalid: true,
    });
  });

  it("revokes analyses and reports linked only through their consent generation", async () => {
    await uploadedAsset(assetOne);
    await consent();
    await analysis({ mediaSourceId: null });
    await skill();
    await draft(draftOne, 0);
    await revokeCanonicalConnection();
    expect(
      (
        await db.query<{
          analysis_invalid: boolean;
          skill_invalid: boolean;
          caption: string;
          manual_description: string;
          terminal_at: string | null;
        }>(`
          select
            a.invalidated_at is not null analysis_invalid,
            s.invalidated_at is not null skill_invalid,
            d.caption,
            d.manual_description,
            d.terminal_at
          from private.creator_growth_analyses a
          join private.creator_growth_skill_invocations s on s.analysis_id=a.id
          join private.creator_growth_drafts d on d.skill_invocation_id=s.id
          where a.id=$1
        `, [analysisOne])
      ).rows[0],
    ).toMatchObject({
      analysis_invalid: true,
      skill_invalid: true,
      caption: "",
      manual_description: "",
    });
    expect(
      (
        await db.query<{ terminal_at: string | null }>(
          "select terminal_at from private.creator_growth_drafts where id=$1",
          [draftOne],
        )
      ).rows[0].terminal_at,
    ).not.toBeNull();
  });

  it("replays an identical command receipt and rejects a changed payload", async () => {
    const request = crypto.randomUUID();
    const payload = {
      id: assetOne,
      threadId: thread,
      sha256: "a".repeat(64),
      mime: "image/png",
      byteSize: 128,
      width: 640,
      height: 640,
      rightsConfirmed: true,
      sourceKind: "creator-upload",
      sampleOnly: false,
    };
    const first = await command(
      "reserve_asset",
      payload,
      creator,
      workspace,
      request,
    );
    expect(
      await command("reserve_asset", payload, creator, workspace, request),
    ).toEqual(first);
    await denied(
      () =>
        command(
          "reserve_asset",
          { ...payload, byteSize: 129 },
          creator,
          workspace,
          request,
        ),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(
      await scalar("select count(*)::int value from private.creator_growth_assets"),
    ).toBe(1);
  });

  it("rejects a second growth-generation revocation command and wrapper", async () => {
    await denied(
      () =>
        command("revoke_generation", {
          connectionId: connection,
          generation: 1,
          revokedAt: now,
        }),
      "INVALID_INPUT",
    );
    expect(
      await scalar(`
        select count(*)::int value
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='creator_growth_revoke_generation'
      `),
    ).toBe(0);
    expect(
      (
        await db.query<{ generation: number; status: string }>(
          "select generation,status from public.integration_connections where id=$1",
          [connection],
        )
      ).rows[0],
    ).toEqual({ generation: 1, status: "connected" });
  });

  it("stores no sensitive result replay and cannot replay an invalidated analysis receipt", async () => {
    await uploadedAsset(assetOne);
    await mediaSource();
    await consent();
    const analysisRequest = crypto.randomUUID();
    await analysis({}, analysisRequest);
    await skill({
      report: evidenceReport({ question: "SENSITIVE REPORT QUESTION" }),
      result: {
        proposal: "SENSITIVE PROPOSAL",
        sourceRefs: [`asset:${assetOne}`],
        limitations: ["sample_only"],
        sampleOnly: false,
      },
    });
    await draft(draftOne, 0, {
      caption: "SENSITIVE CAPTION",
      manualDescription: "SENSITIVE MANUAL DESCRIPTION",
    });

    expect(
      await scalar(`
        select count(*)::int value from information_schema.columns
        where table_schema='private' and table_name='creator_growth_commands'
          and column_name='result'
      `),
    ).toBe(0);
    const ledger = (
      await db.query<{ encoded: string }>(`
        select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text encoded
        from private.creator_growth_commands c
      `)
    ).rows[0].encoded;
    expect(ledger).not.toMatch(/SENSITIVE|observation|proposal|caption|report/i);

    await revokeCanonicalConnection();
    await denied(
      () => analysis({}, analysisRequest),
      "SOURCE_INVALIDATED",
    );
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_commands where request_id=$1",
        [analysisRequest],
      ),
    ).toBe(0);
  });

  it("revokes one connection generation immediately without deleting independent creator-upload data", async () => {
    await uploadedAsset(assetOne);
    await uploadedAsset(assetTwo);
    await mediaSource();
    await consent();
    await analysis();
    await skill();
    await draft(draftOne, 0);
    await draft(draftTwo, 0, {
      assetId: assetTwo,
      analysisId: null,
      skillInvocationId: null,
    });

    await revokeCanonicalConnection();
    const revoked = {
      mediaSources: await scalar(
        "select count(*)::int value from private.creator_growth_media_sources where invalidated_at=$1",
        [now],
      ),
      analyses: await scalar(
        "select count(*)::int value from private.creator_growth_analyses where invalidated_at=$1",
        [now],
      ),
      skillInvocations: await scalar(
        "select count(*)::int value from private.creator_growth_skill_invocations where invalidated_at=$1",
        [now],
      ),
      drafts: await scalar(
        "select count(*)::int value from private.creator_growth_drafts where invalidated_at=$1",
        [now],
      ),
    };
    expect(revoked).toMatchObject({
      mediaSources: 1,
      analyses: 1,
      skillInvocations: 1,
      drafts: 1,
    });
    expect(
      await scalar(
        `select count(*)::int value from private.creator_growth_drafts
         where id=$1 and invalidated_at is not null and revision>1`,
        [draftOne],
      ),
    ).toBe(1);
    expect(
      await scalar(
        `select count(*)::int value from private.creator_growth_drafts
         where id=$1 and invalidated_at is null`,
        [draftTwo],
      ),
    ).toBe(1);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_assets where id=$1",
        [assetOne],
      ),
    ).toBe(1);
    expect(
      await db.query<{ generation: number; status: string }>(
        "select generation,status from public.integration_connections where id=$1",
        [connection],
      ),
    ).toMatchObject({
      rows: [{ generation: 2, status: "revoked" }],
    });
    await denied(
      () =>
        command("save_media_source", {
          id: "00000000-0000-4000-8000-000000000072",
          threadId: thread,
          assetId: assetOne,
          connectionId: connection,
          generation: 1,
          sourceKind: "official_instagram",
          sourceRef: "old-generation",
          subject: "synthetic-subject",
          mediaId: "999",
          permalink: "https://www.instagram.com/p/old",
          rights: "allowed",
          visibility: "public",
          matchStatus: "matched",
          sampleOnly: true,
          observedAt: now,
          fetchedAt: now,
        }),
      "GENERATION_REVOKED",
    );
  });

  it("invalidates growth lineage inside the canonical integration revoke transaction", async () => {
    const integration = await integrationFixture();
    const canonicalDb = integration.db;
    try {
      await canonicalDb.exec(`
        create schema if not exists storage;
        create table if not exists storage.buckets(
          id text primary key,name text not null,public boolean not null,
          file_size_limit bigint,allowed_mime_types text[]
        );
        create table if not exists storage.objects(
          id uuid primary key default gen_random_uuid(),bucket_id text not null,
          name text not null,owner_id uuid
        );
      `);
      await canonicalDb.exec(
        await readFile(
          "supabase/migrations/20261103215321_kocmax_creator_growth_private.sql",
          "utf8",
        ),
      );
      await connectIntegration(canonicalDb);
      const createdThread = await integrationStudio(
        canonicalDb,
        "create_thread",
        { title: "Growth revocation", topic: "creation" },
      );
      const threadId = String(createdThread.id);
      await commandOn(canonicalDb, "reserve_asset", {
        id: assetOne,
        threadId,
        sha256: "a".repeat(64),
        mime: "image/png",
        byteSize: 128,
        width: 640,
        height: 640,
        rightsConfirmed: true,
        sourceKind: "creator-upload",
        sampleOnly: false,
      });
      await commandOn(canonicalDb, "confirm_asset", { assetId: assetOne });
      await commandOn(canonicalDb, "save_media_source", {
        id: mediaOne,
        threadId,
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        sourceKind: "official_instagram",
        sourceRef: "official-source",
        subject: "synthetic-subject",
        mediaId: "789",
        permalink: "https://www.instagram.com/p/synthetic",
        rights: "allowed",
        visibility: "public",
        matchStatus: "matched",
        sampleOnly: true,
        observedAt: now,
        fetchedAt: now,
      });
      await commandOn(canonicalDb, "save_consent", {
        id: consentOne,
        processor: "mock-vision",
        consentVersion: "consent-v1",
        grantedAt: now,
        expiresAt: "2027-01-01T00:00:00Z",
        connectionId: connection,
        generation: 1,
      });
      await commandOn(canonicalDb, "save_analysis", {
        id: analysisOne,
        threadId,
        mediaSourceId: mediaOne,
        assetId: assetOne,
        consentId: consentOne,
        processor: "mock-vision",
        processorVersion: "v1",
        result: {
          observation: {
            availability: "manual",
            reason: "processing_not_approved",
            objects: [],
            visibleText: [],
            composition: [],
            captionAlignment: "unavailable",
            uncertainties: ["synthetic"],
          sampleOnly: false,
          },
          binding: {
            assetId: assetOne,
            sha256: "a".repeat(64),
            sourceKind: "creator-upload",
          },
        },
      });
      await commandOn(canonicalDb, "save_skill_invocation", {
        id: skillOne,
        threadId,
        analysisId: analysisOne,
        mediaSourceIds: [mediaOne],
        skillId: "next_caption",
        report: evidenceReport({
          sampleOnly: true,
          provenance: {
            officialMetrics: [{
              sourceKind: "official_metrics",
              sourceRef: "official-source",
              observedAt: now,
              sampleOnly: true,
              periodKind: "lifetime",
            }],
            publicImageMock: null,
            selfUploadManual: evidenceReport().provenance.selfUploadManual,
          },
          citations: [
            {
              sourceKind: "official_metrics",
              title: "Official source",
              sourceRef: "official-source",
              observedAt: now,
              sampleOnly: true,
            },
            ...evidenceReport().citations,
          ],
        }),
        result: {
          proposal: "SENSITIVE PROPOSAL",
          sourceRefs: ["official-source", `asset:${assetOne}`],
          limitations: ["sample_only"],
          sampleOnly: true,
        },
      });
      await commandOn(canonicalDb, "save_draft", {
        id: draftOne,
        threadId,
        assetId: assetOne,
        analysisId: analysisOne,
        skillInvocationId: skillOne,
        expectedRevision: 0,
        caption: "SENSITIVE CAPTION",
        manualDescription: "SENSITIVE MANUAL DESCRIPTION",
        status: "private",
      });

      await integrationCommand(canonicalDb, "revoke", {
        id: connection,
        generation: 1,
      });
      const connectionRow = (
        await canonicalDb.query<{ generation: number; status: string }>(
          "select generation,status from public.integration_connections where id=$1",
          [connection],
        )
      ).rows[0];
      expect(connectionRow).toEqual({ generation: 2, status: "revoked" });
      expect(
        (
          await canonicalDb.query<{
            analysis_invalid: boolean;
            skill_invalid: boolean;
            caption: string;
            manual_description: string;
            draft_invalid: boolean;
          }>(`
            select
              a.invalidated_at is not null analysis_invalid,
              s.invalidated_at is not null skill_invalid,
              d.caption,
              d.manual_description,
              d.invalidated_at is not null draft_invalid
            from private.creator_growth_analyses a
            join private.creator_growth_skill_invocations s on s.analysis_id=a.id
            join private.creator_growth_drafts d on d.skill_invocation_id=s.id
            where a.id=$1
          `, [analysisOne])
        ).rows[0],
      ).toEqual({
        analysis_invalid: true,
        skill_invalid: true,
        caption: "",
        manual_description: "",
        draft_invalid: true,
      });
    } finally {
      await canonicalDb.close();
    }
  }, 30_000);

  it("keeps public-image provenance separate from official connection requirements", async () => {
    const publicSource = await command("save_media_source", {
      id: "00000000-0000-4000-8000-000000000073",
      threadId: thread,
      assetId: null,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "sample-public-image",
      subject: null,
      mediaId: null,
      permalink: null,
      rights: "unknown",
      visibility: "unknown",
      matchStatus: "unverified",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    });
    expect(publicSource).toMatchObject({
      sourceKind: "public_image_mock",
      connectionId: null,
      invalidatedAt: null,
    });
    await denied(
      () =>
        command("save_media_source", {
          id: "00000000-0000-4000-8000-000000000074",
          threadId: thread,
          assetId: null,
          connectionId: null,
          generation: null,
          sourceKind: "official_instagram",
          sourceRef: "official-without-generation",
          subject: "sample",
          mediaId: "1",
          permalink: "https://www.instagram.com/p/sample",
          rights: "allowed",
          visibility: "public",
          matchStatus: "matched",
          sampleOnly: true,
          observedAt: now,
          fetchedAt: now,
        }),
      "GENERATION_REVOKED",
    );
  });

  it("applies exact retention boundaries, queues cleanup, and deletes no ledger or XP rows", async () => {
    await uploadedAsset(assetOne);
    await uploadedAsset(assetTwo);
    await uploadedAsset(assetThree);
    await uploadedAsset(assetFour);
    await uploadedAsset(assetFive);
    await draft(draftOne, 0, {
      assetId: assetOne,
      analysisId: null,
      skillInvocationId: null,
    });
    await draft(draftTwo, 0, {
      assetId: assetTwo,
      analysisId: null,
      skillInvocationId: null,
    });
    await draft(draftThree, 0, {
      assetId: assetFour,
      analysisId: null,
      skillInvocationId: null,
    });
    await command("set_draft_status", {
      draftId: draftOne,
      input: {
        expectedRevision: 1,
        status: "completed",
        changedAt: "2026-11-04T00:00:00Z",
      },
    });
    await command("set_draft_status", {
      draftId: draftTwo,
      input: {
        expectedRevision: 1,
        status: "cancelled",
        changedAt: "2026-11-04T00:00:00.001Z",
      },
    });
    await command("set_draft_status", {
      draftId: draftThree,
      input: {
        expectedRevision: 1,
        status: "cancelled",
        changedAt: "2026-11-04T00:00:00Z",
      },
    });
    await db.exec(`
      update private.creator_growth_assets
      set created_at='2025-12-04T00:00:00Z',expires_at='2025-12-05T00:00:00Z'
      where id in ('${assetOne}','${assetTwo}','${assetFour}');
      update private.creator_growth_assets
      set created_at='2025-12-05T00:00:00Z',expires_at='2025-12-06T00:00:00Z'
      where id='${assetThree}';
      update private.creator_growth_assets
      set created_at='2026-12-03T00:00:00.001Z',expires_at='2026-12-04T00:00:00.001Z'
      where id='${assetFive}';
    `);
    await command("record_event", {
      id: "00000000-0000-4000-8000-000000000121",
      code: "asset_created",
      entityId: assetOne,
      createdAt: "2026-09-04T23:59:59.999Z",
    });
    await command("record_event", {
      id: "00000000-0000-4000-8000-000000000122",
      code: "asset_created",
      entityId: assetTwo,
      createdAt: "2026-09-05T00:00:00Z",
    });
    const retained = await command("apply_retention", { now });
    expect(retained).toMatchObject({
      draftsDeleted: 2,
      eventsDeleted: 1,
      cleanupQueued: 3,
    });
    expect(
      await scalar("select count(*)::int value from private.creator_growth_assets"),
    ).toBe(2);
    expect(
      await scalar("select count(*)::int value from private.creator_growth_drafts"),
    ).toBe(1);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_storage_cleanup where state='queued' and reason='retention'",
      ),
    ).toBe(3);
    expect(await scalar("select count(*)::int value from public.point_transactions")).toBe(1);
    expect(await scalar("select count(*)::int value from public.creator_scores")).toBe(1);
    expect(
      await scalar(
        "select count(*)::int value from public.integration_connections",
      ),
    ).toBe(2);
  });

  it("deletes invalidated derived drafts when their upstream asset source expires", async () => {
    await uploadedAsset(assetOne);
    await consent();
    await analysis({ mediaSourceId: null });
    await skill();
    await draft(draftOne, 0, {
      caption: "SENSITIVE CAPTION",
      manualDescription: "SENSITIVE MANUAL DESCRIPTION",
    });
    await db.exec(`
      update private.creator_growth_assets
      set created_at='2026-11-02T00:00:00Z',expires_at='2026-11-03T00:00:00Z'
      where id='${assetOne}';
    `);
    await revokeCanonicalConnection();
    const first = await command("apply_retention", { now });
    expect(first).toMatchObject({
      assetsQueued: 1,
      draftsDeleted: 1,
    });
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_drafts where id=$1",
        [draftOne],
      ),
    ).toBe(0);
    const afterThirtyDays = await command("apply_retention", {
      now: "2027-01-03T00:00:00Z",
    });
    expect(afterThirtyDays.draftsDeleted).toBe(0);
  });

  it("purges one owner into a durable cleanup queue and account deletion uses the same path", async () => {
    await uploadedAsset(assetOne);
    await uploadedAsset(assetTwo);
    const purged = await command("purge_owner", {});
    expect(purged).toMatchObject({
      state: "pending_physical_cleanup",
      cleanupQueued: 2,
    });
    expect(
      await scalar("select count(*)::int value from private.creator_growth_assets"),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_storage_cleanup where state='queued'",
      ),
    ).toBe(2);

    await uploadedAsset(assetThree);
    await db.exec(`
      update public.creators set status='suspended' where id='${creator}';
      update public.creators set status='deleted' where id='${creator}';
    `);
    expect(
      await scalar("select count(*)::int value from private.creator_growth_assets"),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_storage_cleanup where state='queued'",
      ),
    ).toBe(3);
    expect(await scalar("select count(*)::int value from public.point_transactions")).toBe(1);
    expect(await scalar("select count(*)::int value from public.creator_scores")).toBe(1);
  });

  it("delays cleanup of a pending upload until its expiry to cover the storage race", async () => {
    const reserved = await reserveAsset();
    await command("purge_owner", {});
    const cleanup = (
      await db.query<{ available_at: string; object_path: string }>(
        `select available_at,object_path
         from private.creator_growth_storage_cleanup
         where reason='owner_purge'`,
      )
    ).rows[0];
    expect(new Date(cleanup.available_at).getTime()).toBe(
      new Date(String(reserved.expiresAt)).getTime(),
    );
    expect(cleanup.object_path).toBe(reserved.storagePath);
  });

  it("keeps service-only cleanup operable after deletion with leases, retries, and exhaustion", async () => {
    await uploadedAsset(assetOne);
    await command("purge_owner", {});
    await db.exec(`
      update public.creators set status='deleted' where id='${creator}';
      update private.creator_growth_storage_cleanup
      set attempts=0,max_attempts=2,available_at='2026-11-04T00:00:00Z',
        state='queued',lease_token=null,lease_expires_at=null,last_error=null;
    `);
    await db.exec("set local role service_role");
    const claim = async (worker: string, at: string) =>
      (
        await db.query<{ result: { items: Row[] } }>(
          `select public.creator_growth_claim_cleanup(
            $1,$2,$3,$4,$5::timestamptz,$6::integer,$7::integer
          ) result`,
          [workspace, creator, crypto.randomUUID(), worker, at, 1, 60],
        )
      ).rows[0].result;
    const finish = async (
      cleanupId: string,
      worker: string,
      objectPath: string,
      outcome: string,
      at: string,
    ) =>
      (
        await db.query<{ result: Row }>(
          `select public.creator_growth_finish_cleanup(
            $1,$2,$3,$4,$5,$6,$7,$8::timestamptz
          ) result`,
          [
            workspace,
            creator,
            crypto.randomUUID(),
            cleanupId,
            worker,
            objectPath,
            outcome,
            at,
          ],
        )
      ).rows[0].result;

    try {
      const workerOne = crypto.randomUUID();
      const firstClaim = await claim(workerOne, now);
      expect(firstClaim.items).toMatchObject([
        { state: "processing", attempts: 1 },
      ]);
      const cleanupId = String(firstClaim.items[0].id);
      const objectPath = String(firstClaim.items[0].objectPath);
      expect(
        await claim(crypto.randomUUID(), now),
      ).toEqual({ items: [] });
      await denied(
        () =>
          finish(
            cleanupId,
            workerOne,
            `${otherWorkspace}/${otherCreator}/${thread}/${assetOne}.png`,
            "failed",
            now,
          ),
        "NOT_FOUND",
      );
      expect(
        await finish(cleanupId, workerOne, objectPath, "failed", now),
      ).toMatchObject({ state: "queued", attempts: 1 });
      expect(
        (
          await db.query<{ result: { items: Row[] } }>(
            `select public.creator_growth_list_cleanup($1,$2,$3) result`,
            [workspace, creator, crypto.randomUUID()],
          )
        ).rows[0].result.items[0],
      ).toMatchObject({
        state: "queued",
        attempts: 1,
        leaseToken: null,
      });

      const secondClaim = await claim(
        crypto.randomUUID(),
        "2026-12-04T00:00:15Z",
      );
      expect(secondClaim.items).toMatchObject([
        { state: "processing", attempts: 2 },
      ]);
      expect(
        await finish(
          cleanupId,
          String(secondClaim.items[0].leaseToken),
          objectPath,
          "failed",
          "2026-12-04T00:00:15Z",
        ),
      ).toMatchObject({ state: "exhausted", attempts: 2 });
    } finally {
      await db.exec("reset role");
    }
  });

  it("uses actual retention receipt and cleanup-queue insertion counts", async () => {
    await uploadedAsset(assetOne);
    await db.exec(`
      update private.creator_growth_assets
      set created_at='2026-11-02T00:00:00Z',expires_at='2026-11-03T00:00:00Z'
      where id='${assetOne}';
      insert into private.creator_growth_storage_cleanup(
        bucket_id,object_path,workspace_id,creator_id,asset_id,reason,available_at
      )
      select 'creator-growth-private',storage_path,workspace_id,creator_id,id,'retention',clock_timestamp()
      from private.creator_growth_assets where id='${assetOne}';
    `);
    const request = crypto.randomUUID();
    const retained = await command("apply_retention", { now }, creator, workspace, request);
    expect(retained).toMatchObject({
      assetsQueued: 1,
      cleanupQueued: 0,
    });
    await db.exec(`
      update private.creator_growth_commands
      set expires_at=clock_timestamp()-interval '1 second'
      where request_id='${request}';
    `);
    const second = await command(
      "apply_retention",
      { now },
      creator,
      workspace,
      crypto.randomUUID(),
    );
    expect(second.receiptsDeleted).toBeGreaterThanOrEqual(1);
  });

  it("queues abandoned uploads at their original reservation expiry", async () => {
    const reserved = await reserveAsset();
    await command("abandon_asset", { assetId: assetOne });
    const cleanup = (
      await db.query<{ available_at: string }>(
        `select available_at from private.creator_growth_storage_cleanup
         where reason='upload_abandoned'`,
      )
    ).rows[0];
    expect(new Date(cleanup.available_at).getTime()).toBe(
      new Date(String(reserved.expiresAt)).getTime(),
    );
  });

  it("queues cleanup before a hard creator delete cascades assets", async () => {
    const reserved = await reserveAsset();
    await confirmAsset();
    await db.exec(`delete from public.creators where id='${creator}'`);
    expect(
      (
        await db.query<{ object_path: string; workspace_id: string; creator_id: string }>(
          `select object_path,workspace_id,creator_id
           from private.creator_growth_storage_cleanup`,
        )
      ).rows,
    ).toEqual([
      {
        object_path: reserved.storagePath,
        workspace_id: workspace,
        creator_id: creator,
      },
    ]);
  });
});


describe("durable route command SQL parity", () => {
  const input = {
    operation: "media/select",
    threadId: thread,
    requestHash: "a".repeat(64),
    assetId: null,
    analysisId: null,
    mediaSourceIds: [],
    connectionId: connection,
    generation: 1,
  };
  async function reserve(
    request: string,
    commandInput: Row = input,
    plan: Row | null = null,
    actor = creator,
    workspaceId = workspace,
  ) {
    // A fresh production adapter on every call, backed only by in-process
    // PGlite. No fetch, Supabase client, external database or storage calls.
    const rpc: GrowthRpc = async <Result,>(
      name: string,
      args: Readonly<Record<string, unknown>>,
    ) => {
      if (name !== "creator_growth_route_command") throw new Error("Unexpected RPC");
      const row = (
        await db.query<{ result: Row }>(
          "select public.creator_growth_route_command($1,$2,$3,$4::jsonb,$5::jsonb) result",
          [
            args.workspaceId,
            args.creatorId,
            args.requestId,
            JSON.stringify(args.input),
            JSON.stringify(args.plan),
          ],
        )
      ).rows[0].result;
      return row as Result;
    };
    const noStorage = async (): Promise<never> => {
      throw new Error("Storage forbidden");
    };
    const repository = new SupabaseGrowthRepository({
      enabled: true,
      rpc,
      storage: { put: noStorage, read: noStorage, remove: noStorage },
    });
    return repository.routeCommand(
      { workspaceId, creatorId: actor },
      commandInput as GrowthRouteCommandInput,
      { idempotencyKey: request },
      plan === null ? undefined : (plan as GrowthRoutePlan),
    );
  }
  it("retains first preparation and time, rejects changed commands, and rechecks revocation", async () => {
    const request = crypto.randomUUID();
    const first = await reserve(request);
    expect(first.plan).toBeNull();
    expect(typeof first.startedAt).toBe("string");
    const plan = {
      operation: "media/select",
      official: {},
      publicImage: {},
      reason: "exact_media_id",
    };
    const prepared = await reserve(request, input, plan);
    expect(prepared.startedAt).toBe(first.startedAt);
    expect(prepared.plan).toEqual(plan);
    expect(
      (
        await db.query<{ later: boolean }>(
          "select clock_timestamp()>$1::timestamptz later",
          [first.startedAt],
        )
      ).rows[0].later,
    ).toBe(true);
    expect(await reserve(request, input, { ...plan, reason: "changed" })).toEqual(
      prepared,
    );
    await denied(
      () => reserve(request, { ...input, requestHash: "b".repeat(64) }),
      "IDEMPOTENCY_CONFLICT",
    );
    await revokeCanonicalConnection();
    await denied(() => reserve(request), "SOURCE_INVALIDATED");
  });
  it("redacts preparations bound through selected sources during canonical revoke", async () => {
    await uploadedAsset();
    await mediaSource();
    const request = crypto.randomUUID();
    const binding = {
      ...input,
      operation: "analyse",
      assetId: assetOne,
      mediaSourceIds: [mediaOne],
      connectionId: null,
      generation: null,
    };
    await reserve(request, binding, {
      operation: "analyse",
      source: null,
      consent: {},
      analysis: {},
    });
    await revokeCanonicalConnection();
    const row = (
      await db.query<{ plan: unknown; invalidated: boolean }>(
        "select plan,invalidated_at is not null invalidated from private.creator_growth_route_commands where request_id=$1",
        [request],
      )
    ).rows[0];
    expect(row).toEqual({ plan: null, invalidated: true });
    await denied(() => reserve(request, binding), "SOURCE_INVALIDATED");
  });
  it("scrubs prepared private content in the same retention sweep that deletes its asset", async () => {
    await uploadedAsset();
    const request = crypto.randomUUID();
    const binding = { ...input, operation: "analyse", assetId: assetOne, connectionId: null, generation: null };
    await reserve(request, binding, { operation: "analyse", source: null, consent: {}, analysis: {} });
    const sweepAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    await command("apply_retention", { now: sweepAt });
    expect(await scalar("select count(*)::int value from private.creator_growth_assets")).toBe(0);
    const row = (await db.query<{ plan: unknown; invalidated: boolean }>("select plan,invalidated_at is not null invalidated from private.creator_growth_route_commands where request_id=$1", [request])).rows[0];
    expect(row).toEqual({ plan: null, invalidated: true });
    await denied(() => reserve(request, binding), "SOURCE_INVALIDATED");
  });
  it("denies inactive owners and expired or invalidated prepared state", async () => {
    const request = crypto.randomUUID();
    await reserve(request);
    await db.query("update public.creators set status='suspended' where id=$1", [
      creator,
    ]);
    await denied(() => reserve(request), "NOT_FOUND");
    await db.query("update public.creators set status='active' where id=$1", [creator]);
    await db.query(
      "update private.creator_growth_route_commands set expires_at=clock_timestamp()-interval '1 second' where request_id=$1",
      [request],
    );
    await denied(() => reserve(request), "IDEMPOTENCY_EXPIRED");
    await command("apply_retention", { now: new Date().toISOString() });
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_route_commands",
      ),
    ).toBe(0);
  });
  it("denies other owners and browser roles and purges prepared private state", async () => {
    const request = crypto.randomUUID();
    await reserve(request);
    await denied(() => reserve(request, input, null, colleague), "NOT_FOUND");
    await denied(
      () => reserve(request, input, null, otherCreator, otherWorkspace),
      "NOT_FOUND",
    );
    await command("purge_owner", {});
    expect(
      await scalar(
        "select count(*)::int value from private.creator_growth_route_commands",
      ),
    ).toBe(0);
    await db.exec("set local role authenticated");
    await denied(() => reserve(request), "permission denied");
  });
});
