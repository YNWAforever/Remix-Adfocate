-- Preserve cross-workspace campaign participation while keeping each
-- submission bound to the workspace of its mission.
alter table public.mission_submissions
  drop constraint if exists mission_submissions_creator_workspace_fk,
  drop constraint if exists mission_submissions_mission_id_fkey;
