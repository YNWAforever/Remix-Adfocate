grant usage on schema private to service_role;
grant execute on function private.touch_creator_profile_media_updated_at() to service_role;
grant execute on function private.uuid_lock_key(uuid) to service_role;
grant execute on function private.is_valid_public_profile_highlights(jsonb) to service_role;
grant execute on function private.enforce_creator_portfolio_highlight_limit() to service_role;
