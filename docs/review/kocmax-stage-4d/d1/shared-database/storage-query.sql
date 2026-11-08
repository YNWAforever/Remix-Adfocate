BEGIN READ ONLY;
SELECT jsonb_build_object(
'buckets',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets')),
'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname='storage' AND tablename IN ('objects','buckets')),
'auth_user_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'function',tgfoid::regprocedure::text,'definition_md5',md5(pg_get_triggerdef(oid,true))) ORDER BY tgname),'[]'::jsonb) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal)
) AS storage_metadata;
ROLLBACK;
