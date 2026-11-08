begin;
lock table private.controlled_pilot_receipts in access exclusive mode;
do $$ begin
 if exists(select 1 from private.controlled_pilot_receipts) then raise exception 'pilot_receipts_not_empty'; end if;
end $$;
drop trigger controlled_pilot_receipt_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_receipt_parent_delete();
drop table private.controlled_pilot_receipts;
commit;
