// @vitest-environment node
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { actor, fixture, studio, ws } from "./helpers/integrations-fixture.js";

const rollbackPath = "docs/review/kocmax-stage-5/creator-growth.rollback.sql";
const assetId = "00000000-0000-4000-8000-000000000071";
const draftId = "00000000-0000-4000-8000-000000000081";
let db: PGlite;
let rollbackSql: string;
let publicationRollback: string;
let threadId: string;
let objectPath: string;
let prerequisites: Awaited<ReturnType<typeof catalog>>;
let prerequisiteRows: Awaited<ReturnType<typeof rows>>;
let expectedRowsAfterRollback: Awaited<ReturnType<typeof rows>>;

async function catalog(target: PGlite = db) {
  // Compare actual catalogs, including definitions and ACLs, not just object counts.
  const schemas = "('public','private','auth','storage')";
  return {
    schemas: (
      await target.query(`select nspname, nspowner, nspacl from pg_namespace
      where nspname in ${schemas} order by nspname`)
    ).rows,
    relations: (
      await target.query(`select n.nspname,c.relname,c.relkind,c.relowner,c.relacl,
      c.relrowsecurity,c.relforcerowsecurity,c.reloptions
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ${schemas} order by n.nspname,c.relname`)
    ).rows,
    columns: (
      await target.query(`select n.nspname,c.relname,a.attnum,a.attname,a.attacl,
      format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid) default_value
      from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname in ${schemas} and a.attnum>0 and not a.attisdropped
      order by n.nspname,c.relname,a.attnum`)
    ).rows,
    constraints: (
      await target.query(`select n.nspname,c.conname,c.conrelid::regclass::text relation,
      pg_get_constraintdef(c.oid) definition from pg_constraint c
      join pg_namespace n on n.oid=c.connamespace
      where n.nspname in ${schemas} order by n.nspname,relation,c.conname`)
    ).rows,
    indexes: (
      await target.query(`select schemaname,tablename,indexname,indexdef from pg_indexes
      where schemaname in ${schemas} order by schemaname,indexname`)
    ).rows,
    triggers: (
      await target.query(`select n.nspname,c.relname,t.tgname,t.tgenabled,
      pg_get_triggerdef(t.oid) definition from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ${schemas} and not t.tgisinternal
      order by n.nspname,c.relname,t.tgname`)
    ).rows,
    policies: (
      await target.query(`select * from pg_policies where schemaname in ${schemas}
      order by schemaname,tablename,policyname`)
    ).rows,
    functions: (
      await target.query(`select n.nspname,p.oid::regprocedure::text signature,
      p.proowner,p.proacl,pg_get_functiondef(p.oid) definition from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ${schemas} order by n.nspname,signature`)
    ).rows,
  };
}

async function rows(target: PGlite = db) {
  const tables = (
    await target.query<{ schemaname: string; tablename: string }>(
      "select schemaname,tablename from pg_tables where schemaname in ('public','private','storage') order by schemaname,tablename",
    )
  ).rows;
  const result: Record<string, unknown[]> = {};
  for (const { schemaname, tablename } of tables) {
    // Identifier quoting is limited to names read from this disposable database.
    const name = [schemaname, tablename]
      .map((v) => `"${v.replaceAll('"', '""')}"`)
      .join(".");
    result[name] = (
      await target.query(
        `select to_jsonb(t) value from ${name} t order by to_jsonb(t)::text`,
      )
    ).rows;
  }
  return result;
}

async function removePublication() {
  // Only the older publication packet's outer transaction is omitted inside our
  // test transaction. The NEW growth rollback file is always executed unchanged.
  await db.exec(publicationRollback);
}

async function refused(message: string) {
  const beforeCatalog = await catalog();
  const beforeRows = await rows();
  // Catch the statement error in a server subtransaction. This lets us inspect
  // its atomicity without a client ROLLBACK hiding earlier committed statements.
  // The nested EXECUTE receives the complete, unmodified file body.
  await db.exec(`do $test_refusal$
    declare observed text;
    begin
      begin
        execute $exact_rollback_file$${rollbackSql}$exact_rollback_file$;
      exception when others then get stacked diagnostics observed=message_text;
      end;
      if observed is distinct from '${message}' then
        raise exception 'Expected refusal %, received %', '${message}', coalesce(observed,'success');
      end if;
    end $test_refusal$;`);
  expect(await catalog()).toEqual(beforeCatalog);
  expect(await rows()).toEqual(beforeRows);
}

async function seedCleanup(state: string, completed = false) {
  await db.query(
    `insert into private.creator_growth_storage_cleanup
    (workspace_id,creator_id,asset_id,object_path,reason,state,completed_at)
    values($1,$2,$3,$4,'retention',$5,case when $6 then now() end)`,
    [ws, actor, assetId, objectPath, state, completed],
  );
}

describe("exact offline full-growth rollback in disposable PGlite", () => {
  beforeAll(async () => {
    ({ db } = await fixture());
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,
        file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),
        bucket_id text not null references storage.buckets(id),name text not null,owner_id uuid);
      alter table storage.objects enable row level security;
      create policy unrelated_bucket_read on storage.objects for select to authenticated
        using(bucket_id='unrelated-private');
      insert into storage.buckets values('unrelated-private','unrelated-private',false,1000,array['text/plain']);
      insert into storage.objects(bucket_id,name) values('unrelated-private','keep.txt');
      insert into public.point_transactions(creator_id,workspace_id,type,delta,source_ref)
        values('${actor}','${ws}','points',7,'rollback-fixture'),
              ('${actor}','${ws}','xp',0,'rollback-fixture');
      insert into public.studio_badges(workspace_id,creator_id,source_event)
        values('${ws}','${actor}','synthetic-rollback-baseline');`);
    threadId = (
      await studio(db, "create_thread", {
        title: "Synthetic rollback fixture",
        topic: "creation",
      })
    ).id as string;
    objectPath = `${ws}/${actor}/${threadId}/${assetId}.jpg`;
    prerequisites = await catalog();
    prerequisiteRows = await rows();
    // With no pre-migration provenance, the generic rollback must retain the
    // empty bucket even when this fixture proves it was newly created. Permit
    // exactly this row in addition to the baseline; no other residuals are hidden.
    expectedRowsAfterRollback = {
      ...prerequisiteRows,
      '"storage"."buckets"': [
        {
          value: {
            id: "creator-growth-private",
            name: "creator-growth-private",
            public: false,
            file_size_limit: 8388608,
            allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
          },
        },
        ...prerequisiteRows['"storage"."buckets"'],
      ],
    };
    await db.exec(
      await readFile(
        "supabase/migrations/20261103215321_kocmax_creator_growth_private.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261104134202_kocmax_publish_intents.sql",
        "utf8",
      ),
    );
    const packet = await readFile(
      "docs/review/kocmax-stage-5/instagram-publish-sql-review.md",
      "utf8",
    );
    const sql = packet.match(
      /<!-- TASK3_ROLLBACK_START -->\s*```sql\s*([\s\S]+?)```/,
    );
    if (!sql) throw new Error("Publication rollback packet missing");
    publicationRollback = sql[1]
      .replace(/^\s*begin;\s*/i, "")
      .replace(/\s*commit;\s*$/i, "");
    rollbackSql = await readFile(rollbackPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        // Missing preparation is RED on behavior instead of a fixture import error.
        if (error.code === "ENOENT")
          return "-- Full-growth rollback not yet prepared";
        throw error;
      },
    );
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    await db.query(
      `insert into private.creator_growth_assets
      (id,workspace_id,creator_id,thread_id,storage_path,sha256,mime,byte_size,width,height,
       rights_confirmed,source_kind,sample_only,fixture_id,upload_state,expires_at)
      values($1,$2,$3,$4,$5,$6,'image/jpeg',100,640,640,true,'synthetic-fixture',true,
        'rollback-fixture','uploaded','2099-01-01')`,
      [assetId, ws, actor, threadId, objectPath, "b".repeat(64)],
    );
    await db.query(
      `insert into private.creator_growth_drafts
      (id,workspace_id,creator_id,thread_id,asset_id,revision,caption,manual_description,status)
      values($1,$2,$3,$4,$5,1,'synthetic caption','','private')`,
      [draftId, ws, actor, threadId, assetId],
    );
    await db.query(
      `insert into private.creator_growth_route_commands
      (workspace_id,creator_id,request_id,thread_id,operation,request_hash,binding,plan)
      values($1,$2,gen_random_uuid(),$3,'analyse',$4,'{}','{"synthetic":true}')`,
      [ws, actor, threadId, "c".repeat(64)],
    );
    await db.query(
      `insert into private.creator_growth_commands
      (workspace_id,creator_id,request_id,action,payload_hash,entity_id)
      values($1,$2,gen_random_uuid(),'reserve_asset',$3,$4)`,
      [ws, actor, "d".repeat(32), assetId],
    );
  });
  afterEach(async () => {
    await db.exec("rollback");
  });

  it("removes only growth objects, retaining only the new empty bucket alongside prerequisites and reward rows", async () => {
    await removePublication();
    const before = await catalog();
    expect(before.indexes.length - prerequisites.indexes.length).toBe(66);
    expect(before.functions.length - prerequisites.functions.length).toBe(39);
    expect(before.triggers.length - prerequisites.triggers.length).toBe(3);
    expect(
      Object.keys(await rows()).length - Object.keys(prerequisiteRows).length,
    ).toBe(11);
    await db.exec(rollbackSql);
    expect(await catalog()).toEqual(prerequisites);
    expect(await rows()).toEqual(expectedRowsAfterRollback);
  });

  it("refuses before publication rollback without changing any data or definitions", async () => {
    await refused("CREATOR_GROWTH_ROLLBACK_PUBLICATION_DEPENDENCIES");
  });

  it("also refuses a partially removed publication installation", async () => {
    await removePublication();
    await db.exec(
      "create function private.creator_publish_time(timestamptz) returns timestamptz language sql as 'select $1'",
    );
    await refused("CREATOR_GROWTH_ROLLBACK_PUBLICATION_DEPENDENCIES");
  });

  it("refuses a nonempty growth bucket even when no cleanup is queued", async () => {
    await removePublication();
    await db.query(
      "insert into storage.objects(bucket_id,name) values('creator-growth-private',$1)",
      [objectPath],
    );
    await refused("CREATOR_GROWTH_ROLLBACK_BUCKET_NOT_EMPTY");
  });

  it.each(["queued", "processing", "exhausted"])(
    "refuses %s cleanup even with an empty bucket",
    async (state) => {
      await removePublication();
      await seedCleanup(state);
      await refused("CREATOR_GROWTH_ROLLBACK_CLEANUP_PENDING");
    },
  );

  it("refuses a completed label without a completion timestamp", async () => {
    await removePublication();
    await seedCleanup("completed");
    await refused("CREATOR_GROWTH_ROLLBACK_CLEANUP_PENDING");
  });

  it("allows completed cleanup receipts only when the bucket is empty", async () => {
    await removePublication();
    await seedCleanup("completed", true);
    await db.exec(rollbackSql);
    expect(await catalog()).toEqual(prerequisites);
    expect(await rows()).toEqual(expectedRowsAfterRollback);
  });

  it("refuses a changed bucket configuration", async () => {
    await removePublication();
    await db.exec(
      "update storage.buckets set public=true where id='creator-growth-private'",
    );
    await refused("CREATOR_GROWTH_ROLLBACK_BUCKET_CONFLICT");
  });

  it("restores definitions, ACLs, bucket and retained growth rows on rollback to savepoint", async () => {
    await removePublication();
    await seedCleanup("completed", true);
    const beforeCatalog = await catalog();
    const beforeRows = await rows();
    await db.exec("savepoint growth_rollback_drill");
    await db.exec(rollbackSql);
    expect(await catalog()).toEqual(prerequisites);
    expect(await rows()).toEqual(expectedRowsAfterRollback);
    await db.exec(
      "rollback to savepoint growth_rollback_drill; release savepoint growth_rollback_drill",
    );
    expect(await catalog()).toEqual(beforeCatalog);
    expect(await rows()).toEqual(beforeRows);
  });

  it("fails atomically on an unexpected dependency instead of dropping it", async () => {
    await removePublication();
    await db.exec(
      "create view public.unrelated_growth_dependency as select id from private.creator_growth_assets",
    );
    await refused(
      "cannot drop table private.creator_growth_assets because other objects depend on it",
    );
  });

  it("preserves a real pre-existing matching bucket, its metadata sentinel and Storage ACLs", async () => {
    const { db: existing } = await fixture();
    try {
      // Insert the bucket BEFORE executing the real forward migration. Its old
      // creation time distinguishes preservation from delete-and-recreate.
      await existing.exec(`create schema storage;
        create table storage.buckets(id text primary key,name text not null,public boolean not null,
          file_size_limit bigint,allowed_mime_types text[],created_at timestamptz not null default now());
        create table storage.objects(id uuid primary key default gen_random_uuid(),
          bucket_id text not null references storage.buckets(id),name text not null,owner_id uuid);
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated,service_role;
        grant select on storage.buckets to service_role;
        grant select(id,name,created_at) on storage.buckets to authenticated;
        create policy preexisting_bucket_read on storage.objects for select to authenticated
          using(bucket_id='creator-growth-private');
        insert into storage.buckets values
          ('creator-growth-private','creator-growth-private',false,8388608,
           array['image/jpeg','image/png','image/webp'],'2000-01-01T00:00:00Z'),
          ('unrelated-private','unrelated-private',false,1000,array['text/plain'],'2001-01-01T00:00:00Z');
        insert into storage.objects(bucket_id,name) values('unrelated-private','keep.txt');`);
      const beforeCatalog = await catalog(existing);
      const beforeRows = await rows(existing);
      const bucket = async () =>
        (
          await existing.query(
            "select to_jsonb(b) value from storage.buckets b where id='creator-growth-private'",
          )
        ).rows;
      const originalBucket = await bucket();
      expect(originalBucket).toHaveLength(1);
      const access = async () =>
        (
          await existing.query(`select
        has_schema_privilege('authenticated','storage','usage') schema_usage,
        has_table_privilege('service_role','storage.buckets','select') table_select,
        has_column_privilege('authenticated','storage.buckets','created_at','select') column_select`)
        ).rows;
      expect(await access()).toEqual([
        { schema_usage: true, table_select: true, column_select: true },
      ]);
      await existing.exec(
        await readFile(
          "supabase/migrations/20261103215321_kocmax_creator_growth_private.sql",
          "utf8",
        ),
      );
      // The real ON CONFLICT path accepted and left the old metadata unchanged.
      expect(await bucket()).toEqual(originalBucket);
      await existing.exec(
        await readFile(
          "supabase/migrations/20261104134202_kocmax_publish_intents.sql",
          "utf8",
        ),
      );
      await existing.exec(publicationRollback);
      await existing.exec(rollbackSql);
      expect(await bucket()).toEqual(originalBucket);
      expect(await access()).toEqual([
        { schema_usage: true, table_select: true, column_select: true },
      ]);
      expect(await catalog(existing)).toEqual(beforeCatalog);
      expect(await rows(existing)).toEqual(beforeRows);
    } finally {
      await existing.close();
    }
  }, 30_000);
});
