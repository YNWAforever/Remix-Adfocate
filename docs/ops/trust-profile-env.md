# Trust Profile Bundle Environment

Required for live social scans:

- `RAPIDAPI_KEY`: RapidAPI key, server-only.
- `RAPIDAPI_INSTAGRAM_PROFILE_URL`: Instagram profile endpoint. Default production value: `https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php`.
- `RAPIDAPI_THREADS_PROFILE_URL`: Threads profile endpoint from the subscribed RapidAPI provider console.
- `CRON_SECRET`: Random value of at least 16 characters. Vercel sends it as `Authorization: Bearer <value>` to cron paths.

Public privacy rules:

- Public passport does not expose social handles, raw follower counts, engagement rates, recent post summaries, provider payloads, or external avatar source URLs.
- A fetched social avatar appears publicly only after the creator chooses it as their Adfocate avatar.

Operational checks:

- Manual scan path: `POST /api/social/accounts/:id/scan`.
- Weekly scan path: `GET /api/cron/social-refresh`.
- If any required RapidAPI scan config is missing, weekly refresh returns a skipped `provider_not_configured` response and does not run scans.
- Cron schedule: Mondays at 03:00 UTC.
