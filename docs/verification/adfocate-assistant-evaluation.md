# Embedded assistant offline evaluation

D20 is implemented and mock-verified only. Live provider and product AI controls remain disabled; this report is not R3 production acceptance. The checklist works independently of AI.

## Protocol and evidence

tests/fixtures/assistant-workflow-eval.json contains24 fixed subcases, four in each N04–N09 category. contextPolicy.test drives the real runAssistant/policy/prompt path with an external-IO double; distinct diff answers read the actual projected prompt and use independent literal expectations. Negative tests enforce every parent link, current Creator ownership, real admin middleware's existing membership/capability gates, caller-role denial, no private sources, no embeddings, no tools/mutations, unknown/stale/unpublished handling and failure fallback. The current approved snapshot flag comes from the existing work-item pointer and is not approval history or a new decision.

D20-case-coverage.json records every subcase and its four evidence layers.24/24 controlled cases pass; N04/N05 mock answer-handling8/8, scope/tools8/8, unknown/stale/unpublished4/4 and failures4/4. Those percentages grade application behavior and deterministic transport output, not a real language model. KB/URL-metadata/internal-note injection variants verify exclusion plus hostile-tool denial; they are not evidence of model obedience to those sources.

True provider answer-quality rubric threshold remains90%; observed quality is null/NOT_RUN. Live request count0; tokens and inference latency are not measured, billable calls0. No real provider use, budget, credential or test-content approval is inferred. No real prompts/content were sent to any provider.

## User experience and safety

Creator DraftEditor and operator ActiveMissionReview use the existing canonical requirements and selection. The panel loads only on demand, shows deterministic rules first, and displays sources, exact version basis, stale warning, limits and human confirmation wording. It never invokes an approval, reward, publication or payment operation. API output is explicitly transient not_saved.403/404/409/429/provider-unknown preserve the question;409/unknown stop resends and429 manual retry retains its ID. Switching context aborts a delayed reply. EN390px and ZH1280px screenshots are controlled offline mock evidence; the6 Edge cases are static-component/API-transport mocks with zero external requests, not real Auth/RLS/DB E2E.

The server validates the message/UUIDs, derives actor/workspace/role from the existing authenticated gates, then reauthorizes each selected record. No client role is accepted. Scoped context never includes general chat history, internal notes, private assets, signed/raw draft URLs, global KB or finance amounts. Only bounded brief text, frozen checklist and exact versions enter the prompt. No tools are offered; even a hostile tool call is rejected before execution. Unknown or malformed output falls back, with no storage-success claim.

## Live activation gates still open

Keep live provider disabled. A separately authorized limited provider/content/budget evaluation must meet security/unknown100% and true answer rubric>=90%, record actual usage/latency/errors and be reviewed by a human. First review/extend the existing D16 durable request/quota contract for staff and context binding, including cross-instance retry, crash-unknown, replay authorization and source changes; do not enable this transient mock path as a paid stateless service. Existing general creator chat persistence is unchanged. No exactly-once billing promise is made.

D15 approved curriculum, formal staff owner assignment/cutover and hosted release gates stay open. D19 real workflow and financial-neutrality evidence remains historical and unmodified. No R3 enablement, deployment or production changes were performed. See D20-delivery.md and D20-schema-diff.json for scope and rollback.
