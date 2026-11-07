# Mock keyboard and focus recovery

2026-11-05. Same branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Uncommitted, index empty. No deployment, SQL changes/application, real connections, posts or rewards.

## Changes

The dev-only native rehearsal requests focus after explicit actions: conversion error → alert; reset/edit/restart → enabled scenario selector; simulated revoke → stopped notice. Alert and stopped notice use tabindex=-1 (programmatic focus only). Initial mount and identity remount do not request focus; generation checks suppress obsolete asynchronous error focus. Native Tab order and buttons/links remain intact.

## Evidence

- 92 tests PASS across 6 files: mock UI14, preview32, Studio9, image workspace17, fixture ownership19, production boundary1. Focus assertions failed before implementation and passed afterwards. Late completion and outside-focus preservation covered.
- TypeScript, scoped ESLint and diff whitespace checks PASS. Opt-in production build still excludes all42 development markers. Independent read-only review found no actionable findings.
- 390×844: Enter on conversion button triggers deliberate error; active DOM element is P role=alert with the safe error text. Tab lands on return-to-normal button; Enter returns focus to SELECT with value receipt. Scroll width384. [Mobile evidence](mock-focus-mobile.png).
- 1440×1000: Enter starts preparation then revokes; active element is stopped DIV role=status. Tab lands on fresh-example button; Enter returns focus to SELECT with value receipt. Visible focus outline observed; scroll width1434. [Desktop evidence](mock-focus-desktop.png).
- Browser viewport reset. Tests use mocked image bytes; browser uses generated local pixels. No real upload/provider flow exercised.

Scope: targeted keyboard/focus acceptance only, not a full assistive-technology, screen-reader or WCAG audit. No production code path or authoritative task/reward behavior changed. Logs: `.superpowers/sdd/mock-focus-*.log`; prior review artifacts remain historical.
