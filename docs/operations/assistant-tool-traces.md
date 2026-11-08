# Studio tool traces (optional)

Studio chat answers show which read-only account tools backed them (`tools_used`). By default the
trace is only kept for the current turn. Applying the SQL in
[`assistant-tool-traces.sql`](assistant-tool-traces.sql) makes the chips survive reloads.

This is **optional and out of band**, so it is not part of `supabase/migrations` or the release
manifest: the migration tracker is managed manually for this project (see the deployment runbook).

## Apply (Supabase SQL editor, project `mhkoayftiuojxlrkollf`)

1. Open the SQL editor.
2. Paste and run `assistant-tool-traces.sql`.
3. No redeploy is needed — the server already writes traces best-effort and starts reading them
   as soon as the table exists.

## Behaviour without the table

Nothing is written, nothing errors, and the chat shows tool chips for the current turn only. The
helpers in `server/lib/studio/toolTraces.ts` fail open on purpose.

## Rollback

```sql
drop table if exists public.assistant_tool_traces;
```

Existing chat answers are unaffected; only the persisted tool chips disappear.
