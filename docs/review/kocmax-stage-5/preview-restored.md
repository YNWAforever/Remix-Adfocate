# Preview recovery and delayed error isolation

2026-11-05, codex/kocmax-studio-stages-1-2. No production source edits, deployment, SQL, real connections or commits.

Port8768 was occupied but unresponsive. Started the mock-only Vite preview on127.0.0.1:8770 with placeholder credentials and fixture/Studio flags. Browser successfully opened the app. Selected synthetic creator, opened connections, simulated source401. Mobile390x844 and desktop1440x1000 displayed login recovery; scroll widths384 and1434. Normal fixture plus reload restored connect controls. Reset viewport; kept preview tab. Screenshot: preview-restored-mobile.png.

Next mock phase added delayed start401/503 after creator A-to-B switch. Checks no forced login, private error leakage, replay or B-list mutation. Existing implementation passes; no production fix claimed. Selected integration/Home/Workspace regression123/123 across7 files passed; account suite34 tests. Log: .superpowers/sdd/preview-restored-tests.log.

Earlier lifecycle additions (delayed revoke/purge after creator switch) are included in this run. Browser verification covers recovery UI and reload, not injected operation races; those are component tests. No live Auth/RLS/provider acceptance is claimed.
