// LOCAL MOCK ONLY. Original workflow/reward SQL is loaded without rewriting its commands.
import {readFile} from "node:fs/promises";
import type {PGlite} from "@electric-sql/pglite";
import {initializeOriginalWorkflow} from "../../../test/helpers/controlled-pilot-original-workflow.js";
export async function initializePilotFixture(db:PGlite,atomic=false){
 await initializeOriginalWorkflow(db,atomic);
 for(const path of ["server/test/helpers/controlled-pilot-binding-fixture.sql","docs/review/kocmax-controlled-pilot/changes.sql"])await db.exec(atomic?(await readFile(path,"utf8")).replace(/^\s*(begin|commit);\s*$/gim,""):await readFile(path,"utf8"));
}
