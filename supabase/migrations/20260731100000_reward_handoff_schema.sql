-- Reward handoff foundation. Rewards remain pending until a later, explicit ledger settlement phase.

alter table public.workspaces
  add column reward_processing_window_days smallint
  check (reward_processing_window_days between 0 and 365);

alter table public.mission_workflows
  add column revision integer not null default 0 check (revision >= 0),
  drop constraint if exists mission_workflows_state_check,
  add constraint mission_workflows_state_check check (
    state in (
      'accepted','fulfillment_pending','drafting','in_review','revision_requested',
      'approved_to_publish','publication_in_progress','proof_verified',
      'reward_pending','cancelled','expired'
    )
  );

create table public.mission_reward_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null unique references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  mission_id uuid not null references public.missions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null default 'HKD' check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null default 0 check (xp_amount >= 0),
  source text not null check (source in ('join','operator_backfill')),
  source_mission_updated_at timestamptz,
  confirmed_by uuid references auth.users(id),
  confirmation_evidence_source text check (
    confirmation_evidence_source in ('mission_brief','signed_agreement','operator_record','other')
  ),
  confirmation_reason text,
  created_at timestamptz not null default now(),
  check (
    (source = 'join' and confirmed_by is null
      and confirmation_evidence_source is null and confirmation_reason is null)
    or
    (source = 'operator_backfill' and confirmed_by is not null
      and confirmation_evidence_source is not null
      and nullif(btrim(confirmation_reason), '') is not null)
  )
);

create table public.mission_completion_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  decision_kind text not null check (decision_kind in ('approved','cancelled')),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  pending_reward_id uuid,
  supersedes_decision_id uuid references public.mission_completion_decisions(id),
  workflow_revision integer not null check (workflow_revision >= 0),
  required_item_count integer not null check (required_item_count >= 0),
  verified_required_item_count integer not null check (verified_required_item_count >= 0),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  reason_category text,
  reason_note text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_hash text not null check (btrim(request_hash) <> ''),
  unique (workspace_id, idempotency_key)
);

create table public.mission_pending_rewards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  creator_id uuid not null references public.creators(id),
  mission_id uuid not null references public.missions(id),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  completion_decision_id uuid not null unique references public.mission_completion_decisions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null check (xp_amount >= 0),
  status text not null default 'pending' check (status in ('pending','cancelled')),
  processing_window_days smallint check (processing_window_days between 0 and 365),
  target_at timestamptz,
  cancellation_decision_id uuid unique references public.mission_completion_decisions(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

alter table public.mission_completion_decisions
  add constraint mission_completion_decisions_pending_reward_fk
  foreign key (pending_reward_id) references public.mission_pending_rewards(id);

create unique index mission_pending_rewards_one_pending_idx
  on public.mission_pending_rewards (mission_workflow_id)
  where status = 'pending';

create index mission_reward_contracts_workspace_workflow_idx
  on public.mission_reward_contracts (workspace_id, mission_workflow_id);
create index mission_reward_contracts_workspace_submission_idx
  on public.mission_reward_contracts (workspace_id, mission_submission_id);
create index mission_reward_contracts_workspace_mission_idx
  on public.mission_reward_contracts (workspace_id, mission_id);
create index mission_completion_decisions_workspace_workflow_idx
  on public.mission_completion_decisions (workspace_id, mission_workflow_id, decided_at desc);
create index mission_completion_decisions_workspace_contract_idx
  on public.mission_completion_decisions (workspace_id, reward_contract_id);
create index mission_completion_decisions_workspace_pending_reward_idx
  on public.mission_completion_decisions (workspace_id, pending_reward_id)
  where pending_reward_id is not null;
create index mission_pending_rewards_workspace_creator_idx
  on public.mission_pending_rewards (workspace_id, creator_id, created_at desc);
create index mission_pending_rewards_workspace_workflow_idx
  on public.mission_pending_rewards (workspace_id, mission_workflow_id);
create index mission_pending_rewards_workspace_submission_idx
  on public.mission_pending_rewards (workspace_id, mission_submission_id);
create index mission_pending_rewards_workspace_mission_idx
  on public.mission_pending_rewards (workspace_id, mission_id);

alter table public.mission_reward_contracts enable row level security;
alter table public.mission_completion_decisions enable row level security;
alter table public.mission_pending_rewards enable row level security;

-- Browser clients receive bounded creator data through a later ownership-checking RPC.
revoke all on table
  public.mission_reward_contracts,
  public.mission_completion_decisions,
  public.mission_pending_rewards
from public, anon, authenticated;
grant all on table
  public.mission_reward_contracts,
  public.mission_completion_decisions,
  public.mission_pending_rewards
to service_role;

create or replace function private.guard_reward_contract_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;

create or replace function private.guard_completion_decision_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;

create or replace function private.guard_pending_reward_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.cancellation_decision_id is null
     and old.cancelled_at is null
     and new.status = 'cancelled'
     and new.cancellation_decision_id is not null
     and new.cancelled_at is not null
     and (to_jsonb(new) - array['status', 'cancellation_decision_id', 'cancelled_at'])
       is not distinct from
       (to_jsonb(old) - array['status', 'cancellation_decision_id', 'cancelled_at'])
  then
    return new;
  end if;

  raise exception 'immutable_record';
end;
$$;

create trigger mission_reward_contracts_immutable
  before update or delete on public.mission_reward_contracts
  for each row execute function private.guard_reward_contract_immutable();
create trigger mission_completion_decisions_immutable
  before update or delete on public.mission_completion_decisions
  for each row execute function private.guard_completion_decision_immutable();
create trigger mission_pending_rewards_guarded_update
  before update or delete on public.mission_pending_rewards
  for each row execute function private.guard_pending_reward_update();

revoke all on function private.guard_reward_contract_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_completion_decision_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_pending_reward_update()
  from public, anon, authenticated, service_role;
