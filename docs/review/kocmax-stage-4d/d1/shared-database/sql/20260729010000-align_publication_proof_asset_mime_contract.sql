alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_mime_type_check;

alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_mime_type_check
  check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'video/webm'
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'mission-publication-proof-assets',
  'mission-publication-proof-assets',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
