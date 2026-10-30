begin;

-- F-047: kb_documents/kb_chunks were readable by every authenticated user (`using (true)`),
-- and match_kb_chunks (SECURITY INVOKER) trusted a caller-supplied filter_workspace, so any
-- creator could read another brand's workspace-scoped knowledge. Reads are now limited to
-- global documents plus the caller's own workspace (stored as its id or slug); chunks follow
-- their document. Server-side ingestion uses the service role and is unaffected.
drop policy if exists kb_documents_read on public.kb_documents;
create policy kb_documents_read on public.kb_documents for select to authenticated
  using (
    workspace is null
    or workspace = (select private.current_workspace_id())::text
    or workspace = (select w.slug from public.workspaces w where w.id = (select private.current_workspace_id()))
  );

drop policy if exists kb_chunks_read on public.kb_chunks;
create policy kb_chunks_read on public.kb_chunks for select to authenticated
  using (exists (select 1 from public.kb_documents d where d.id = kb_chunks.document_id));

commit;
