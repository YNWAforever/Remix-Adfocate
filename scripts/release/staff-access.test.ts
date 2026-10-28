import { resolve } from "node:path";
import { expect,it } from "vitest";
import { buildManifest,currentReleaseCapabilities } from "./manifest";
import { hasCapabilityValidator } from "./preflight";
it("D18 release manifest includes the reviewed forward staff-access contract",async()=>{
 const manifest=await buildManifest(resolve("."));
 const migration=manifest.migrations.find(m=>m.version==="20261023124149");
 expect(migration).toMatchObject({phase:"staff_access",dependsOn:["20261023095521"],transactionExpectation:"transactional",replayExpectation:"migration_history_noop"});
 expect(migration?.capabilities).toEqual(expect.arrayContaining(["table:public.staff_workspace_roles","table:public.staff_platform_roles","table:public.staff_access_audit","table:public.staff_access_commands","function:public.set_staff_workspace_role","function:private.bootstrap_staff_access"]));
 const capabilities=currentReleaseCapabilities(manifest);expect(capabilities.length).toBeGreaterThan(501);expect(capabilities.filter(c=>!hasCapabilityValidator(c))).toEqual([]);
});
