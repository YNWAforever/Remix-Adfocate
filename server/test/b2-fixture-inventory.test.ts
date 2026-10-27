import { describe, expect, it } from "vitest";
// @ts-expect-error Pure local inventory query builder, no SQL execution in this test.
import { fixtureInventorySql, assertInventoryCaps } from "../../scripts/audit/b2-fixture-inventory.mjs";
const ids={workspaces:["11111111-1111-4111-8111-111111111111"],auth_users:["22222222-2222-4222-8222-222222222222"]};
const scopes={mission_workflows:{relation:"public.mission_workflows",key:["id"],selector:"workspace"},staff_platform_roles:{relation:"public.staff_platform_roles",key:["user_id","role"],selector:"auth-user"}};
describe("B2 exact scoped child inventory",()=>{
 it("builds a read-only snapshot with row IDs/hashes, bound to current exact workspace and Auth IDs",()=>{
  const sql=fixtureInventorySql(scopes,ids);
  expect(sql).toMatch(/^begin read only;/);expect(sql).toContain(ids.workspaces[0]);expect(sql).toContain(ids.auth_users[0]);expect(sql).toContain("md5(to_jsonb(t)::text)");expect(sql).not.toMatch(/insert |update |delete |truncate /i);
 });
 it("rejects a malformed ID or undeclared selector before SQL is invoked",()=>{
  expect(()=>fixtureInventorySql(scopes,{...ids,auth_users:["';unsafe"]})).toThrow(/ID/i);
  expect(()=>fixtureInventorySql({x:{relation:"public.x",key:["id"],selector:"anywhere"}},ids)).toThrow(/selector/i);
 });
 it("fails closed on missing child families or counts over the reviewed caps",()=>{
  expect(()=>assertInventoryCaps({mission_workflows:{count:2,ids:[]}}, {mission_workflows:1})).toThrow(/cap/i);
  expect(()=>assertInventoryCaps({}, {mission_workflows:1})).toThrow(/missing/i);
  expect(()=>assertInventoryCaps({mission_workflows:{count:1,ids:["owned"]}}, {mission_workflows:1})).not.toThrow();
 });
});
