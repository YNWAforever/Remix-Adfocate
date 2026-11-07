-- REVIEW ONLY. Never erase lifetime reservations or unknown evidence to make rollback pass.
begin;
lock table private.controlled_pilot_media in access exclusive mode;
do $$ begin
 if exists(select 1 from private.controlled_pilot_media) then raise exception 'pilot_media_not_empty'; end if;
end $$;
drop trigger controlled_pilot_media_parent_delete on private.creator_publish_intents;
drop function private.controlled_pilot_media_parent_delete();
drop table private.controlled_pilot_media;
commit;
