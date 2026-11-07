-- Read-only preflight, no writes. Count/boolean output, no personal records returned.
-- Checked 2026-10-31: four booleans passed; recheck before future approved execution.
-- Run only after the target and catalog check, before approving an update window.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'submission_workspace_consistency' AS check_name,
  NOT EXISTS (SELECT 1 FROM public.mission_submissions s
    JOIN public.missions m ON m.id=s.mission_id
    JOIN public.creators c ON c.id=s.creator_id
    WHERE s.workspace_id IS DISTINCT FROM m.workspace_id OR s.workspace_id IS DISTINCT FROM c.workspace_id) AS passed
UNION ALL
SELECT 'point_reward_source_uniqueness', NOT EXISTS (
  SELECT 1 FROM public.point_transactions WHERE source_ref LIKE 'mission_reward:%'
  GROUP BY source_ref HAVING count(*)>1)
UNION ALL
SELECT 'cash_reward_source_uniqueness', NOT EXISTS (
  SELECT 1 FROM public.earnings_transactions WHERE source_ref LIKE 'mission_reward:%'
  GROUP BY source_ref HAVING count(*)>1)
UNION ALL
SELECT 'new_bucket_ids_unused', NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets'));
-- A false result or timeout is STOP, never permission to rewrite existing rows.
ROLLBACK;
