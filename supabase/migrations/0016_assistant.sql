-- 0016_assistant.sql — AI Creator Assistant knowledge base + conversations
create extension if not exists vector;

-- Knowledge base ---------------------------------------------------------
create table public.kb_documents (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null check (source_type in ('article','mission_brief','reward','level','legal')),
  source_ref   text not null,                 -- slug / origin id
  title        text not null,
  locale       text not null default 'zh-HK',
  workspace    text,                          -- null = global
  content      text not null,
  content_hash text not null,
  updated_at   timestamptz not null default now(),
  unique (source_type, source_ref, locale)
);

create table public.kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  token_count int not null default 0,
  embedding   vector(1536) not null
);
create index kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);
create index kb_chunks_document_idx on public.kb_chunks(document_id);

-- Conversations ----------------------------------------------------------
create table public.assistant_conversations (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references auth.users(id) on delete cascade,
  workspace       text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index assistant_conv_creator_idx on public.assistant_conversations(creator_id);

create table public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool')),
  content         text not null,
  citations       jsonb not null default '[]'::jsonb,
  tool_calls      jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index assistant_msg_conv_idx on public.assistant_messages(conversation_id);

-- Retrieval RPC (SECURITY INVOKER so RLS on kb_chunks still applies) ------
create or replace function public.match_kb_chunks(
  query_embedding vector(1536),
  match_count     int default 5,
  filter_locale   text default 'zh-HK',
  filter_workspace text default null
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  source_type text,
  source_ref  text,
  content     text,
  similarity  float
)
language sql stable
as $$
  select c.id, c.document_id, d.title, d.source_type, d.source_ref, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where d.locale = filter_locale
    and (d.workspace is null or d.workspace = filter_workspace)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- RLS --------------------------------------------------------------------
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

create policy kb_documents_read on public.kb_documents for select to authenticated using (true);
create policy kb_chunks_read    on public.kb_chunks    for select to authenticated using (true);

create policy conv_self on public.assistant_conversations
  for all to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());

create policy msg_self on public.assistant_messages
  for all to authenticated using (
    exists (select 1 from public.assistant_conversations conv
            where conv.id = conversation_id and conv.creator_id = auth.uid())
  ) with check (
    exists (select 1 from public.assistant_conversations conv
            where conv.id = conversation_id and conv.creator_id = auth.uid())
  );

-- Grants -----------------------------------------------------------------
grant select on public.kb_documents, public.kb_chunks to authenticated;
grant all    on public.kb_documents, public.kb_chunks to service_role;
grant all    on public.assistant_conversations, public.assistant_messages to authenticated;
grant all    on public.assistant_conversations, public.assistant_messages to service_role;
grant execute on function public.match_kb_chunks(vector, int, text, text) to authenticated, service_role;
