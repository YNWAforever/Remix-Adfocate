import { writeFileSync } from "node:fs";
import { createAuditFixture } from "../../server/test/auditWorkflowFixture";
const fixture = await createAuditFixture();
const mission = await fixture.mission("active_workspace", false);
const creator = fixture.creators[0];
writeFileSync(".codex-tmp/browser-fixture.private.json", JSON.stringify({
  runId:fixture.runId, workspaceId:fixture.workspaceId, slug:fixture.slug, mission,
  creator:{id:creator.id,email:creator.email,password:creator.password,jwt:creator.jwt},
  operator:{id:fixture.operator.id,email:fixture.operator.email,password:fixture.operator.password,jwt:fixture.operator.jwt},
  operatorSession:fixture.operator.session,
  beforeSnapshot:await fixture.neutrality(creator.id),
}));
process.stdout.write("Browser fixture created on verified disposable target; credentials retained only in ignored local file.\n");
