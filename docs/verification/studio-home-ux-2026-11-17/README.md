# Studio home UI audit — 2026-11-17

Branch `codex/studio-home-ux` (PR #171), captured from the fixture-backed dev server.

## How it was captured

- `VITE_STUDIO_SHELL=true VITE_STUDIO_THREADS=true VITE_STUDIO_FIXTURE=true npm run dev -- --port 5199`
- `KOCMAX_LOCAL_PILOT_DIRECTORY=.superpowers/controlled-pilot-local-ux-audit` keeps the audit run away from other local pilot data.
- Fixture role `creator` (`sessionStorage["kocmax-local-preview-role"]`), locale `zh-Hant-HK`, Chromium through Playwright.
- `home-1440.png` (1440×1000) and `home-390.png` (390×844) are full-page captures with the fixed bottom navigation hidden; `home-390-hero.png` keeps it and is a true viewport shot.

## Findings

- No horizontal overflow at either width: `scrollWidth === clientWidth` (1440/1440, 390/390).
- Stat row: three tiles from 768px up, two columns plus a full-width third tile at 767px and below, single column at 359px and below.
- Order and content match the plan: stat row, welcome hero, unfinished-mission card, composer, growth skill deck, idea deck, then today's missions, recent threads and the reward card.
- The hero greets the creator by `display_name` (the fixture renders `阿晴，今天想創作些甚麼？`), and a verified badge count appears under recent threads when the account has badges.
- Disabled primary submit keeps a legible label: `#665d78` on `--s-lilac` is 5.11:1.
- Token contrast (WCAG AA): muted `#706881` 5.05–5.27:1, purple `#7145cc` 5.88–6.13:1, ink `#302a45` 13.05:1.
- Console output only contains the fixture-mode Supabase "auth is disabled" notice, which is expected without env keys.

## Fixture-only artifacts in these images

- The dark top bar (role and scenario switchers) and the "本機演練" banner belong to the local fixture harness, not production.
- The reward card shows its empty state because the fixture gift list is empty; the claimable and points-gap states are covered by `StudioHome.test.tsx`.