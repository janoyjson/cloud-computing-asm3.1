# CloudSentinel deployment evidence

This record contains non-secret smoke-test evidence for the current Learner Lab deployment. Credentials, API keys, webhook URLs, and session links are intentionally excluded.

## Verified 9 September 2026

| Component | Evidence |
|---|---|
| API Gateway | `https://k6mghyhlb9.execute-api.us-east-1.amazonaws.com` responded successfully for health, endpoint listing, and analytics. |
| Lambda | `CloudSentinelApi`, Node.js 22, 35-second timeout; latest bundle includes endpoint lifecycle, incident history, PageSpeed, analytics, and access-token support. |
| DynamoDB | `CloudSentinelMonitors`, `CloudSentinelChecks`, `CloudSentinelIncidents`, and `CloudSentinelPerformance` are active. |
| ECS/Fargate | API-started manual check produced an `UP` result and updated the monitor state. |
| S3 | Frontend assets and partitioned check results are present in the web and results buckets. |
| Glue | `cloudsentinel-checks-crawler` finished with `SUCCEEDED`. The duplicate JSON `endpointid` column was removed while retaining the partition key. |
| Athena | The application analytics route returned 81 checks, 6 UP, 75 DOWN, 7.41% uptime, 372.22 ms average response time, and 1 incident. |
| PageSpeed Insights | The application performance route returned mobile scores of 100 performance, 96 accessibility, 96 best practices, and 80 SEO. |
| Incident history | `GET /v1/endpoints/{id}/incidents` returned persisted history through the dashboard API. |
| Frontend | Updated AWS-connected assets were uploaded to `cloudsentinel-web-a7b3k9`. HTTPS S3 object delivery loads the dashboard and connects to API Gateway. |

## Routes added during final verification

- `DELETE /v1/endpoints/{id}`
- `GET /v1/endpoints/{id}/incidents`

Both routes have API Gateway integrations and Lambda invoke permissions. CORS now permits `content-type` and `authorization` headers for the configured web origins.

## Remaining evidence to capture for submission

- AWS Console screenshots for the routes, Lambda configuration, ECS task, S3 objects, Glue crawler/table, Athena query, and CloudWatch logs.
- A final solution architecture document in Word or PDF format with live URL, repository link, diagrams, related work, API/data descriptions, and IEEE references.
- A clean-browser demonstration of create, update, disable/enable, delete, check, incident history, PageSpeed, and analytics.
