begin;

-- F-048: creators held INSERT/UPDATE/DELETE on their assistant conversations and messages
-- (grant all + `for all` policies), so a creator could forge role='assistant' replies or
-- delete history that assistant_requests receipts reference. History is written only by the
-- SECURITY DEFINER assistant RPCs (reserve_assistant_request / save_assistant_turn), so
-- browser roles keep read access to their own rows and nothing else.
revoke insert, update, delete, truncate on table public.assistant_conversations from anon, authenticated;
revoke insert, update, delete, truncate on table public.assistant_messages from anon, authenticated;

drop policy if exists conv_self on public.assistant_conversations;
create policy conv_self on public.assistant_conversations for select to authenticated
  using (creator_id = (select auth.uid()));

drop policy if exists msg_self on public.assistant_messages;
create policy msg_self on public.assistant_messages for select to authenticated
  using (exists (select 1 from public.assistant_conversations conv
    where conv.id = assistant_messages.conversation_id and conv.creator_id = (select auth.uid())));

commit;
