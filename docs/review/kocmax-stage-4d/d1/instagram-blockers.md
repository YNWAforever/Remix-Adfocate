# Instagram gates at D1

No private Meta console or real Instagram account has been connected. D0 protocol fixtures are not provider acceptance.

| Gate | Status | Evidence required before activation |
| --- | --- | --- |
| IG-01 revoke | BLOCKED | Official Instagram Login method/path/token/ID/result/retry/range contract for the candidate DELETE permissions endpoint |
| IG-02 notice identity | BLOCKED | Exact Meta app / Instagram app / code-exchange subject / profile / signed callback identity mapping; never infer equality |
| IG-03 canonical authorize host | OPEN | Resolve `www.instagram.com/oauth/authorize` in Business Login against `api.instagram.com/oauth/authorize` in the OAuth reference for the approved app/product |
| IG-04 account/access eligibility | NOT VERIFIED | Creator/Business type, ownership/management, app membership and actual access level for each scope |
| IG-05 real smoke | D2 NOT RUN | Specifically approved identity and revoke smoke, then media/metric reconciliation |

Sources from the D0/D1 planning audit: [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login), [OAuth reference](https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize), [Insights](https://developers.facebook.com/documentation/instagram-platform/insights), [generic deletion callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback). Generic Facebook app-scoped ID guidance does not prove Instagram Login mapping.

Unknown mappings must not change another grant or report deletion completed. The signed-request freshness limit in D0 fixtures is a local policy, not a verified provider redelivery contract. Future live notices require that contract and replay tests before activation.

Google readiness may be assessed independently, but it does not clear Instagram or authorize Google D2. Current live state for both is disabled.
