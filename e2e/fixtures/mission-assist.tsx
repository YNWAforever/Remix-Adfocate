import { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import { DraftEditor } from "@/components/active-mission/DraftEditor";
import { ActiveMissionReview } from "@/components/admin/ActiveMissionReview";
import type { ActiveMissionWorkflow } from "@/lib/admin";
import type { MissionWorkItemView } from "@/lib/activeMission";
import fixture from "../../tests/fixtures/assistant-workflow-eval.json";
import "../../src/styles.css";

const Panel = lazy(() => import("@/components/assistant/MissionAssistPanel"));
const id = fixture.ids;
const context = { workspaceId: id.workspace, missionId: id.mission, workflowId: id.workflow, workItemId: id.item, versionId: id.v1, mode: "explain_brief" as const };
const checklist = [{ id: "ad", text: "Include #ad", complete: false }];
function Harness() {
  const query = new URLSearchParams(location.search), staff = query.has("staff");
  const [versionId, setVersionId] = useState(id.v1);
  const [closed, setClosed] = useState(false);
  const item = { id: id.item, title: "Synthetic reel", platform: "instagram", requirements: [{ id: "ad", label: "Include #ad", required: true }], state: "drafting", required: true, position: 0, deadline: null, draft: null, currentSubmittedVersionId: id.v1, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null } satisfies MissionWorkItemView;
  const noop = async () => {};
  const workflow = { workflow: { id: id.workflow, revision_limit: 2 }, submission: { creators: { id: id.creator, display_name: "Synthetic creator" }, missions: { id: id.mission, title: "Synthetic brief", description: "Show product." } },
    workItems: [{ id: id.item, title: item.title, platform: "instagram", position: 0, state: "under_review", deadline: null, current_reviewer_id: null, current_submitted_version_id: id.v2, approved_version_id: id.v1, requirements_snapshot: [{ id: "ad", text: "Include #ad", required: true }] }],
    versions: [{ id: id.v2, mission_work_item_id: id.item, version_number: 2, caption_snapshot: "Product #ad", external_draft_url_snapshot: null, checklist_snapshot: { ad: true }, submitted_at: "2026-10-23T00:00:00Z" }], fulfillment: null, reviews: [], grants: [], events: [], assets: [],
  } satisfies ActiveMissionWorkflow;
  return <main className="mx-auto max-w-4xl space-y-4 p-3"><h1>D20 offline mock harness</h1><p>Synthetic content; no real provider, Auth, database or business actions.</p>
    {query.has("mock") ? <>
      <button type="button" onClick={() => setVersionId(id.v2)} className="min-h-11 border px-3">Switch to v2</button>
      {!closed && <Suspense fallback={<p>Loading…</p>}><Panel context={{ ...context, versionId, mode: staff ? "summarize_changes" : "explain_brief" }} checklist={checklist} enabled staffWorkspace={staff ? "offline-workspace" : undefined} onClose={() => setClosed(true)} /></Suspense>}
    </> : staff ? <ActiveMissionReview workflow={workflow} assistWorkspace="offline-workspace" onStartReview={noop} onRequestRevision={noop} onGrantRevision={noop} onApproveVersion={noop} onMarkShipped={noop} />
      : <DraftEditor item={item} assistContext={context} onSave={noop} onSubmit={noop} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Harness /></I18nProvider>);
