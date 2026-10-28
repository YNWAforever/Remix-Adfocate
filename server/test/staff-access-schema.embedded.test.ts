// @vitest-environment node
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const target=Object.freeze({storage:"memory://",transport:"in-process-wasm",network:"none"});
let db:PGlite;
const A="10000000-0000-4000-8000-000000000001",B="10000000-0000-4000-8000-000000000002";
const admin="20000000-0000-4000-8000-000000000001",subject="20000000-0000-4000-8000-000000000002",foreign="20000000-0000-4000-8000-000000000003",editor="20000000-0000-4000-8000-000000000004",request="30000000-0000-4000-8000-000000000001";
async function value<T=unknown>(sql:string,args:unknown[]=[]):Promise<T>{return (await db.query<{value:T}>(sql,args)).rows[0]?.value;}
async function rejected(sql:string,args:unknown[],message:string){await db.exec("savepoint expected_failure");await expect(db.query(sql,args)).rejects.toThrow(message);await db.exec("rollback to savepoint expected_failure");}
async function ready(){expect(await value("select to_regprocedure('public.set_staff_workspace_role(uuid,uuid,uuid,text,boolean,integer,uuid,text)') is not null as value")).toBe(true);}
async function bootstrap(user=admin,workspace:string|null=A,role="workspace_admin"){
 return value("select private.bootstrap_staff_access($1,$2,$3,$4,true,0,gen_random_uuid(),'Explicit owned fixture setup','synthetic-owner-reference') as value",[admin,workspace,user,role]);
}
const command="select public.set_staff_workspace_role($1,$2,$3,$4,$5,$6,$7,$8) as value";
const args=()=>[A,admin,subject,"reviewer",true,0,request,"Approved owned fixture access"];
beforeAll(async()=>{
 expect(target).toEqual({storage:"memory://",transport:"in-process-wasm",network:"none"});
 const {PGlite:Engine}=await import("@electric-sql/pglite");db=await Engine.create(target.storage);
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;grant usage on schema private to service_role;create table auth.users(id uuid primary key);create table public.workspaces(id uuid primary key,slug text);create table public.staff_users(user_id uuid primary key,email text,active boolean);create table public.brand_users(user_id uuid primary key,workspace_id uuid,active boolean);insert into auth.users values('${admin}'),('${subject}'),('${foreign}'),('${editor}');insert into public.workspaces values('${A}','a'),('${B}','b');insert into public.staff_users values('${admin}','a@example.invalid',true),('${subject}','b@example.invalid',true),('${foreign}','c@example.invalid',true),('${editor}','d@example.invalid',true);insert into public.brand_users values('${admin}','${A}',true),('${subject}','${A}',true),('${foreign}','${B}',true);`);
 await db.exec(await readFile("supabase/migrations/20261023124149_staff_access_capabilities.sql","utf8"));
},60000);
beforeEach(async()=>{await db.exec("begin");});afterEach(async()=>{await db.exec("rollback");});afterAll(async()=>{await db?.close();});
it("D18 migration adds no automatic staff grants and browsers cannot self-assign",async()=>{
 await ready();expect(await value("select count(*)::integer as value from public.staff_workspace_roles")).toBe(0);
 await db.exec("set local role authenticated");
 await rejected("insert into public.staff_workspace_roles(user_id,workspace_id,role,granted_by) values($1,$2,'workspace_admin',$1)",[subject,A],"permission denied");
 await rejected(command,args(),"permission denied");await db.exec("reset role");
 expect(await value("select count(*)::integer as value from public.staff_access_audit")).toBe(0);
});
it("D18 workspace grant persists actor, revision and audit in one command",async()=>{
 await ready();await bootstrap();const result=await value(command,args());
 expect(result).toMatchObject({userId:subject,workspaceId:A,role:"reviewer",active:true,revision:1});
 expect(await value("select granted_by::text as value from public.staff_workspace_roles where user_id=$1",[subject])).toBe(admin);
 expect(await value("select actor_id::text as value from public.staff_access_audit where request_id=$1",[request])).toBe(admin);
});
it("D18 exact replay returns the same saved result and one audit",async()=>{
 await ready();await bootstrap();const first=await value(command,args());expect(await value(command,args())).toEqual(first);
 expect(await value("select count(*)::integer as value from public.staff_access_audit where request_id=$1",[request])).toBe(1);
});
it("D18 same request with different content conflicts without another mutation",async()=>{
 await ready();await bootstrap();await value(command,args());const changed=args();changed[3]="operator";
 await rejected(command,changed,"STAFF_ACCESS_IDEMPOTENCY_CONFLICT");
 expect(await value("select role as value from public.staff_workspace_roles where user_id=$1",[subject])).toBe("reviewer");
});
it("D18 stale grant revision conflicts",async()=>{
 await ready();await bootstrap();await value(command,args());const stale=args();stale[6]="30000000-0000-4000-8000-000000000002";
 await rejected(command,stale,"STAFF_ACCESS_STALE");
});
it.each(["staff","membership","role"])("D18 revoked %s denies even an exact successful request replay",async kind=>{
 await ready();await bootstrap();await value(command,args());
 await db.query(kind==="staff"?"update public.staff_users set active=false where user_id=$1":kind==="membership"?"update public.brand_users set active=false where user_id=$1":"update public.staff_workspace_roles set active=false where user_id=$1",[admin]);
 await rejected(command,args(),"STAFF_ACCESS_FORBIDDEN");
});
it("D18 normal access.manage cannot self-change or grant to another workspace",async()=>{
 await ready();await bootstrap();const self=args();self[2]=admin;await rejected(command,self,"STAFF_SELF_CHANGE_FORBIDDEN");
 const cross=args();cross[2]=foreign;await rejected(command,cross,"STAFF_TARGET_NOT_ELIGIBLE");
});
it("D18 audit failure rolls back role and command receipt",async()=>{
 await ready();await bootstrap();await db.exec("alter table public.staff_access_audit add constraint synthetic_audit_failure check(reason<>'force-audit-failure')");
 const failed=args();failed[7]="force-audit-failure";await rejected(command,failed,"synthetic_audit_failure");
 expect(await value("select count(*)::integer as value from public.staff_workspace_roles where user_id=$1",[subject])).toBe(0);
 expect(await value("select count(*)::integer as value from public.staff_access_commands where request_id=$1",[request])).toBe(0);
});
it("D18 an admin can revoke an existing grant after its target loses staff or membership",async()=>{
 await ready();await bootstrap();await value(command,args());
 await db.query("update public.staff_users set active=false where user_id=$1",[subject]);await db.query("delete from public.brand_users where user_id=$1",[subject]);
 const revoke=args();revoke[4]=false;revoke[5]=1;revoke[6]="30000000-0000-4000-8000-000000000003";
 expect(await value(command,revoke)).toMatchObject({active:false,revision:2});
});
it("D18 platform content editor is separate and owner bootstrap is not callable by service or browser roles",async()=>{
 await ready();await bootstrap(editor,null,"content_editor");
 expect(await value("select role as value from public.staff_platform_roles where user_id=$1",[editor])).toBe("content_editor");
 expect(await value("select count(*)::integer as value from public.staff_workspace_roles where user_id=$1",[editor])).toBe(0);
 await db.exec("set local role service_role");await rejected("select private.bootstrap_staff_access($1,null,$1,'content_editor',true,0,gen_random_uuid(),'attempt','fake-owner')",[subject],"permission denied");
});
