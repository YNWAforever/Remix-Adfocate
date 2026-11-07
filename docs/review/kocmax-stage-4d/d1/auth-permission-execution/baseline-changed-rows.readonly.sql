-- Read-only, opaque comparison for the two tables with unchanged counts but changed hashes.
-- Never emits row values, IDs, emails or password hashes.
BEGIN READ ONLY;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SELECT jsonb_build_object(
  'missions',
  (SELECT jsonb_agg(jsonb_build_object(
      'id_tag',md5(m.id::text),
      'row_hash',md5(to_jsonb(m)::text),
      'field_hashes',(SELECT jsonb_object_agg(e.key,md5(e.value::text))
                      FROM jsonb_each(to_jsonb(m)) e)
    ) ORDER BY m.id)
   FROM public.missions m
   WHERE m.id <> '446802cb-4f6c-418d-967a-bf5f1cf63ea5'::uuid),
  'auth_users',
  (SELECT jsonb_agg(jsonb_build_object(
      'id_tag',md5(u.id::text),
      'row_hash',md5(to_jsonb(u)::text),
      'without_login_hash',md5((to_jsonb(u)-'last_sign_in_at'-'updated_at')::text),
      'last_sign_in_hash',md5(to_jsonb(u.last_sign_in_at)::text),
      'updated_at_hash',md5(to_jsonb(u.updated_at)::text),
      'field_hashes',(SELECT jsonb_object_agg(e.key,md5(e.value::text))
                      FROM jsonb_each(to_jsonb(u)) e)
    ) ORDER BY u.id)
   FROM auth.users u
   WHERE u.raw_app_meta_data->'auth_pilot'->>'run_id' IS DISTINCT FROM '5f694251-c6eb-4f5f-a281-25e91db81c04'
  )
) AS row_hashes;
ROLLBACK;
