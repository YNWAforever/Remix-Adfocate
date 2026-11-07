import type {PGlite} from '@electric-sql/pglite';
type Db=Pick<PGlite,'query'|'exec'>;
type Table={schema:string;name:string;columns:{name:string;type:string;generated:string;identity:string}[];rows:string[]};
export type LocalPilotDump={sampleOnly:true;tables:Table[]};
const ident=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const name=(t:Table)=>`${ident(t.schema)}.${ident(t.name)}`;
async function tables(db:Db):Promise<Table[]>{
 const result=await db.query<{schema:string;name:string;columns:Table['columns']}>(`select n.nspname schema,c.relname name,json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname in ('public','private','auth','storage') and c.relkind='r' group by n.nspname,c.relname order by n.nspname,c.relname`);
 return result.rows.map(t=>({...t,rows:[]}));
}
async function assertMock(db:Db){const rows=(await db.query<{snapshot:{sampleOnly?:boolean}}>('select snapshot from private.controlled_pilot_local_meta where id=1')).rows;if(rows.length!==1||rows[0].snapshot.sampleOnly!==true)throw Error('MOCK_ONLY');}
async function rows(db:Db,t:Table){return (await db.query<{value:string}>(`select row_to_json(t)::text value from ${name(t)} t order by row_to_json(t)::text collate "C"`)).rows.map(r=>r.value);}
/** Visible committed snapshot only; invisible/future-XID tuples remain in the retained physical evidence. */
export async function exportVisiblePilot(db:PGlite):Promise<LocalPilotDump>{return db.transaction(async tx=>{await tx.exec('set transaction read only;');await assertMock(tx);const result=await tables(tx);for(const t of result)t.rows=await rows(tx,t);return {sampleOnly:true,tables:result};});}
export async function restoreVisiblePilot(db:PGlite,dump:LocalPilotDump,options:{quarantineOrphans?:boolean}={}){
 if(dump.sampleOnly!==true)throw Error('MOCK_ONLY');
 return db.transaction(async tx=>{
  await assertMock(tx);const target=await tables(tx);
  if(JSON.stringify(target)!==JSON.stringify(dump.tables.map(t=>({...t,rows:[]}))))throw Error('LOCAL_SCHEMA_MISMATCH');
  // Target is a newly initialized local fixture. No source or remote SQL is executed here.
  await tx.exec('set local session_replication_role=replica;');
  await tx.exec(`truncate ${target.map(name).join(',')};`);
  for(const t of dump.tables){const cols=t.columns.filter(c=>!c.generated).map(c=>ident(c.name)).join(',');for(const row of t.rows)await tx.query(`insert into ${name(t)} (${cols}) overriding system value select ${cols} from json_populate_record(null::${name(t)},$1::json)`,[row]);}
  for(const t of dump.tables)if(JSON.stringify(await rows(tx,t))!==JSON.stringify(t.rows))throw Error('LOCAL_ROW_MISMATCH');
  // Replica loading bypasses FK triggers, so verify each composite FK before committing.
  const fks=(await tx.query<{child:string;parent:string;childCols:string[];parentCols:string[]}>(`select conrelid::regclass::text child,confrelid::regclass::text parent,array(select attname from unnest(conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=conrelid and a.attnum=k.attnum order by k.ord) "childCols",array(select attname from unnest(confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=confrelid and a.attnum=k.attnum order by k.ord) "parentCols" from pg_constraint where contype='f' and connamespace in (select oid from pg_namespace where nspname in ('public','private','auth','storage'))`)).rows;
  let quarantined=0,changed=false;
  if(options.quarantineOrphans)await tx.exec('create table private.controlled_pilot_recovery_quarantine(original_table text not null,original_row jsonb not null,reason text not null);alter table private.controlled_pilot_recovery_quarantine enable row level security;revoke all on private.controlled_pilot_recovery_quarantine from public;');
  do{
   changed=false;
   for(const f of fks){
    const nonNull=f.childCols.map(c=>`c.${ident(c)} is not null`).join(' and '),eq=f.childCols.map((c,i)=>`p.${ident(f.parentCols[i])}=c.${ident(c)}`).join(' and ');
    const predicate=`${nonNull} and not exists(select 1 from ${f.parent} p where ${eq})`;
    if(!(await tx.query(`select 1 from ${f.child} c where ${predicate} limit 1`)).rows.length)continue;
    if(!options.quarantineOrphans)throw Error('BROKEN_REFERENCE:'+f.child+'->'+f.parent);
    const removed=(await tx.query<{value:string}>(`delete from ${f.child} c where ${predicate} returning row_to_json(c)::text value`)).rows;
    for(const r of removed)await tx.query('insert into private.controlled_pilot_recovery_quarantine values($1,$2::jsonb,$3)',[f.child,r.value,'Missing visible parent: '+f.parent]);
    quarantined+=removed.length;changed=removed.length>0||changed;
   }
  }while(changed);
  await tx.exec("set local session_replication_role=origin;update private.controlled_pilot_local_meta set value=jsonb_set(value,'{stopped}','true'::jsonb) where id=1;");
  return {tables:dump.tables.length,rows:dump.tables.reduce((n,t)=>n+t.rows.length,0),quarantined,stopped:true};
 });
}
