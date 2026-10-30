begin;

-- F-009: creators could not delete their account, and a hard delete of auth.users is blocked
-- by RESTRICT/NO ACTION references (lesson progress, redemption codes, proof attempts, pending
-- rewards, assistant requests, referrals) and append-only workflow history. Deletion is
-- therefore an anonymisation: personal data is removed or scrubbed, while ledgers, decisions
-- and audit rows stay intact under the now-pseudonymous creator id. The API additionally
-- removes stored avatar files and scrambles/bans the auth identity.
alter table public.creators drop constraint creators_status_chk;
alter table public.creators add constraint creators_status_chk
  check (status in ('active', 'suspended', 'pending_review', 'deleted'));
alter table public.creators add column deleted_at timestamptz;

create function public.anonymize_creator_account(p_creator uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_creator public.creators%rowtype;
begin
  select * into v_creator from public.creators where id = p_creator for update;
  if not found then raise exception 'not_found'; end if;
  if v_creator.status = 'deleted' then
    return jsonb_build_object('creator_id', p_creator, 'deleted_at', v_creator.deleted_at, 'replay', true);
  end if;

  update public.creators set
    display_name = 'Deleted KOC', avatar_url = null, phone = null, referral_code = null,
    social_handles = '[]'::jsonb, categories = '{}', status = 'deleted', deleted_at = clock_timestamp()
  where id = p_creator returning * into v_creator;

  delete from public.creator_social_accounts where creator_id = p_creator;
  delete from public.creator_portfolio_links where creator_id = p_creator;
  delete from public.creator_public_profile_snapshots where creator_id = p_creator;
  delete from public.creator_public_passports where creator_id = p_creator;
  delete from public.notifications where user_id = p_creator;
  delete from public.campaign_participants where creator_id = p_creator;
  delete from public.mission_shortlists where creator_id = p_creator;
  -- Conversations are referenced by request receipts, so their free text is scrubbed instead.
  update public.assistant_messages set content = '[deleted]'
    where conversation_id in (select id from public.assistant_conversations where creator_id = p_creator);

  return jsonb_build_object('creator_id', p_creator, 'deleted_at', v_creator.deleted_at, 'replay', false);
end;
$$;
revoke all on function public.anonymize_creator_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_creator_account(uuid) to service_role;

commit;
