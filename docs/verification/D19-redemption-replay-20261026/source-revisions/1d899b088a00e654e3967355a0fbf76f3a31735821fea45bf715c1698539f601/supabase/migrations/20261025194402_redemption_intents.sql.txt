-- Replay receipts live on the existing redemption, never in a new ledger.
-- Financial/code/stock work still runs through the original redeem_gift once.
begin;

alter table public.redemptions add column client_request_id uuid;
create unique index redemptions_creator_request_uniq
  on public.redemptions (creator_id, client_request_id)
  where client_request_id is not null;

-- A unique RPC name preserves the old one-argument API without API overloads.
create function public.redeem_gift_with_request(p_gift uuid, p_request_id uuid)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_red public.redemptions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'bad_request'; end if;
  select workspace_id into v_ws from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('redemption:' || v_creator::text || ':' || p_request_id::text, 0)
  );
  select * into v_red from public.redemptions
    where creator_id = v_creator and client_request_id = p_request_id;
  if v_red.id is not null then
    if v_red.gift_id is distinct from p_gift or v_red.workspace_id is distinct from v_ws then
      raise exception 'request_conflict';
    end if;
    -- A saved result is recoverable even if the first action exhausted stock.
    return v_red;
  end if;

  v_red := public.redeem_gift(p_gift);
  update public.redemptions as r set client_request_id = p_request_id
    where r.id = v_red.id and r.creator_id = v_creator
    returning r.* into v_red;
  if v_red.id is null then raise exception 'redemption_receipt_failed'; end if;
  return v_red;
end;
$$;

revoke all on function public.redeem_gift_with_request(uuid, uuid) from public, anon;
grant execute on function public.redeem_gift_with_request(uuid, uuid) to authenticated, service_role;

commit;
