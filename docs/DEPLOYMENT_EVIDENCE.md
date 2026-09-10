# CloudSentinel deployment evidence

This record contains non-secret smoke-test evidence for the current Learner Lab deployment. Credentials, API keys, webhook URLs, and session links are intentionally excluded.

## Verified 9 September 2026

| Component | Evidence |
|---|---|
| API Gateway | `https://k6mghyhlb9.execute-api.us-east-1.amazonaws.com` responded successfully for health, endpoint listing, and analytics. |
| Application auth | Signed JWT register/sign-in flow protects the dashboard without requiring Cognito administration; Learner Lab stores `entityType=USER` records in the existing monitors table. |
| Lambda | `CloudSentinelApi`, Node.js 22, 35-second timeout; latest bundle includes endpoint lifecycle, incident history, PageSpeed, analytics, and application JWT authentication. |
| DynamoDB | `CloudSentinelMonitors`, `CloudSentinelChecks`, `CloudSentinelIncidents`, and `CloudSentinelPerformance` are active. |
| ECS/Fargate | API-started manual check produced an `UP` result and updated the monitor state. |
| S3 | Frontend assets and partitioned check results are present in the web and results buckets. |
| Glue | `cloudsentinel-checks-crawler` finished with `SUCCEEDED` on 10 September 2026. The duplicate JSON `endpointid` column was removed while retaining the partition key, so Athena can read the partitioned S3 history. |
| Athena | The application analytics route returned 384 checks, 0 UP, 384 DOWN, 0% uptime, 410.90 ms average response time, and 2 incidents for the demo04 account's last 24 hours. |
| PageSpeed Insights | The application performance route returned mobile scores of 100 performance, 96 accessibility, 96 best practices, and 80 SEO. |
| Incident history | `GET /v1/endpoints/{id}/incidents` returned persisted history through the dashboard API. |
| Frontend | Updated AWS-connected assets were uploaded to `cloudsentinel-web-a7b3k9`. HTTPS S3 object delivery loads the dashboard and connects to API Gateway. |
| Seed data | Five demo accounts and ten owned monitor records were inserted into `CloudSentinelMonitors`; GSI queries returned exactly two monitors for each account with no unprocessed batch items. |
| JWT live test | Demo01 and Demo02 login returned tokens; each account loaded only its own two URLs. Demo02 still loaded both URLs after a full browser reload. |
| Scheduler live test | Ten `cloudsentinel-seed-demo-*` schedules are `ENABLED`; five-minute schedules produced persisted `UP` checks with HTTP 200. |

## Routes added during final verification

- `DELETE /v1/endpoints/{id}`
- `GET /v1/endpoints/{id}/incidents`

Both routes have API Gateway integrations and Lambda invoke permissions. CORS now permits `content-type` and `authorization` headers for the configured web origins.

The Lambda JWT guard protects every route except health and register/login. An unauthenticated request to `/v1/endpoints` returns `401`, while `/v1/health` returns `200` during verification.

The `CloudSentinelMonitors` table has the non-destructive `ownerId-createdAt-index` GSI. New monitor records use the application JWT `sub` as `ownerId`; run `services/api/scripts/assign-monitor-owner.ps1` once with the registered demo user's `sub` to migrate pre-authentication lab records.

## Remaining evidence to capture for submission

- AWS Console screenshots for the routes, Lambda configuration, ECS task, S3 objects, Glue crawler/table, Athena query, and CloudWatch logs.
- A final solution architecture document in Word or PDF format with live URL, repository link, diagrams, related work, API/data descriptions, and IEEE references.
- A clean-browser demonstration of create, update, disable/enable, delete, check, incident history, PageSpeed, and analytics.
- A clean-browser account registration/sign-in capture followed by authenticated endpoint operations is now verified for seeded Demo01 and Demo02 accounts.
