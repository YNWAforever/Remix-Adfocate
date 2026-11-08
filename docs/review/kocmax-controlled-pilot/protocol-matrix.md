# Controlled pilot protocol matrix

2026-11-06. Read-only public documentation, no App login, API credential, grant or request.

| Boundary | Documentation basis | Actual pilot status |
|---|---|---|
| Candidate Facebook Login | Meta collection describes Professional IG with linked Page | BLOCKED: actual App/account eligibility not verified |
| Host | `graph.facebook.com`; existing Instagram Login stays distinct | Documentation only |
| Version | Collection uses `{{api_version}}` | BLOCKED: no version pinned from actual App evidence; never invent a current version |
| Publishing permissions | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`; Page discovery may require `pages_show_list` | BLOCKED: exact minimal scope set/access level not approved or granted |
| Paid partnership | Meta-maintained organic-content guide describes Facebook Login label capability | BLOCKED: creator/brand eligibility and actual label verification |
| Revocation / signed notice | No exact candidate App-specific verified contract collected | BLOCKED: no guessed endpoint or identity mapping |
| Transport | Native fixed-host HTTP boundary with injected wire and secret reader | Offline tests only; no default fetch, loaded token or live registration |
| Public media, SQL, Auth/RLS, deployment | Separate approved artifacts required | NOT_RUN |

Sources: [Meta Postman collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta organic-content guide](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/creators/organic-content-creation.md). The main [content publishing documentation](https://developers.facebook.com/documentation/instagram-platform/content-publishing) was inaccessible through the read tool on this date. The collection includes broader operations; its full permission list is not this pilot's requested scope list. No live authority follows from documentation or test fixtures.

Versioned transport/identity tests may use synthetic versions and evidence references; they never promote this matrix to PASS. No authorization, insight, messaging or advertising request has been made.
