# CloudSentinel delivery roadmap

The phases are deliberately ordered as thin, demonstrable increments. A phase is complete only when its exit criteria can be shown, not merely when AWS resources exist.

## Phase 1 - Foundation and local thin slice

Status: Complete (26 August 2026)

Required work:

- Translate the assignment rubric into implementation evidence.
- Freeze the minimum viable product and explicitly defer optional features.
- Define system boundaries, user journeys, data structures, and API contracts.
- Create the TypeScript monorepo and quality checks.
- Scaffold the React dashboard, Lambda API, ECS monitoring worker, shared package, and CDK package.
- Demonstrate endpoint registration and immediate-check behavior locally with mock data.
- Add deterministic unit tests for validation, uptime calculations, and HTTP checks.

Exit criteria:

- `pnpm check` passes.
- The local dashboard can add an endpoint and simulate a check.
- No AWS credentials or manually created cloud resources are required.
- The architecture and every planned service have a documented purpose.

## Phase 2 - Core AWS platform and first deployed path

Status: Complete (2 September 2026)

Required work:

- Confirm AWS Learner Lab region, quotas, IAM restrictions, and available services.
- Create and document the AWS resources manually in the Management Console.
- Implement DynamoDB tables for monitors, check results, and incidents.
- Implement API Gateway routes backed by Lambda functions.
- Replace the API in-memory repository with DynamoDB access.
- Provision an S3 website bucket; add CloudFront only if the Learner Lab permission test succeeds.
- Connect the React application to the deployed API.
- Add CORS, environment configuration, structured errors, and deployment outputs.
- Deploy the first end-to-end path: dashboard -> API Gateway -> Lambda -> DynamoDB.

Exit criteria:

- A live S3 website URL, or CloudFront URL when permitted, loads the dashboard.
- Creating and listing a monitor uses AWS automatically, without console/CLI data entry.
- The flow is visible in logs and can be demonstrated from the client interface.

## Phase 3 - Containerized monitoring and scheduling

Status: Complete (7 September 2026)

Progress evidence (7 September 2026):

- The hardened worker image builds and passes local container startup checks on Node.js 24.
- Version `0.2.0` is published to the immutable `cloudsentinel-monitor-worker` ECR repository.
- A manually launched Fargate task exited successfully and produced matching evidence in CloudWatch Logs, DynamoDB, and the encrypted S3 results bucket.
- The deployed API Gateway route invokes Lambda, which starts a monitor-specific Fargate task automatically.
- The API-started task exited successfully and produced matching evidence in CloudWatch Logs, DynamoDB, and the encrypted S3 results bucket.
- The updated dashboard is deployed to S3, and its "Run check" action was verified against the live API and Fargate worker; EventBridge Scheduler integration remains.
- The application-managed create, update, disable, and delete schedule lifecycle is implemented and tested.
- A dashboard-created five-minute schedule invoked Fargate automatically and stored an `UP`, `SCHEDULED` result in CloudWatch Logs, DynamoDB, and an AES256-encrypted S3 object.

Required work:

- Harden the monitoring worker with timeouts, redirects, user-agent identification, and safe URL validation.
- Package and publish the worker image to Amazon ECR.
- Provision ECS Fargate cluster, task definition, networking, logs, and least-privilege task roles.
- Implement "Run now" by starting an ECS task through application code.
- Create, update, and delete EventBridge Scheduler schedules automatically when monitor settings change.
- Persist scheduled and immediate check results in DynamoDB and S3.

Exit criteria:

- A dashboard action invokes ECS and produces a real result.
- EventBridge Scheduler invokes checks without manual console execution.
- Task logs and stored results prove the full automated path.

## Phase 4 - Incidents and notifications

Status: Complete (8 September 2026)

Progress evidence:

- The incident transition engine opens only on the first failure, suppresses repeated failures, and resolves on recovery.
- DynamoDB incident persistence and Discord delivery use the protected `cloudsentinel/discord-webhook` Secrets Manager value.
- Notification success/failure metadata is persisted without discarding completed monitoring results.
- Unit tests cover outage, duplicate-failure, recovery, unsafe webhook URLs, and webhook errors.
- A live controlled `404` opened one DynamoDB incident and sent one Discord outage notification; a repeated failure created no duplicate; a later `200` resolved the incident and sent one recovery notification.

Required work:

- Define outage, repeated failure, recovery, and notification-deduplication rules.
- Create incident records when an endpoint transitions from up to down.
- Close incidents automatically when the endpoint recovers.
- Integrate one notification webhook API and protect its secret.
- Add incident history and active-incident views to the dashboard.
- Test failure, duplicate-failure, recovery, and webhook-error behavior.

Exit criteria:

- A controlled failing endpoint creates one incident and one alert.
- Repeated failures do not create notification spam.
- Recovery closes the incident and sends the recovery notification.

## Phase 5 - Performance checks and historical analytics

Status: In progress (local implementation complete; AWS deployment pending)

Progress evidence:

- Added a mobile PageSpeed Insights client requesting performance, accessibility, best-practices, and SEO categories.
- Added timestamped `PerformanceResult` contracts and a DynamoDB repository for `CloudSentinelPerformance`.
- Added API routes and a dashboard `PageSpeed` action with safe loading/error states.
- Added deterministic unit tests for request construction, score parsing, persistence commands, API routes, and browser requests.
- Added an Athena query adapter, incident-count scan, analytics API route, and dashboard analytics summary with a date-range contract.

Remaining deployment evidence is the manual Glue crawler/Athena setup, Lambda/API Gateway update, and one live dashboard analytics response.

Required work:

- Integrate Google PageSpeed Insights through an application workflow.
- Store PageSpeed scores and selected metrics with timestamps.
- Partition historical check data in S3.
- Configure the Glue Data Catalog/crawler for the S3 dataset.
- Implement Athena queries for uptime, incident count, and response-time trends.
- Invoke Athena automatically from a Lambda-backed dashboard route.
- Add readable charts, time-range selection, loading states, and empty states.

Exit criteria:

- The UI starts PageSpeed analysis and displays a persisted result.
- The analytics page invokes Athena through application code.
- Charts are based on deployed historical data rather than hard-coded values.

## Phase 6 - Security, resilience, observability, and cost control

Status: In progress (API SSRF boundary implemented; deployment pending)

Progress evidence:

- Added API-side DNS/IP validation for loopback, private, link-local, metadata, multicast, and IPv6 unique-local destinations.
- Rejected URL credentials and converted blocked destinations into safe HTTP 400 validation responses.
- Added deterministic security tests for unsafe addresses and public-host resolution.

Required work:

- Prevent server-side request forgery by rejecting unsafe/private destinations.
- Apply least-privilege IAM policies and remove wildcard permissions where feasible.
- Store external secrets outside code and redact them from logs.
- Add DynamoDB recovery/retention settings appropriate to the Learner Lab.
- Configure CloudWatch logs, metrics, alarms, correlation identifiers, and retention.
- Add retry/backoff rules and dead-letter handling where appropriate.
- Review CloudFront/S3 security, API throttling, input limits, and error exposure.
- Estimate demo usage and define a teardown procedure to avoid unnecessary spend.

Exit criteria:

- Security tests cover URL validation and unauthorized/invalid requests.
- Failures are diagnosable from logs without exposing secrets.
- A documented cost and teardown checklist exists.

## Phase 7 - Evidence, solution architecture document, and demo

Required work:

- Capture final AWS-console and application evidence for every claimed service.
- Produce diagrams for interactive, scheduled-monitoring, alerting, PageSpeed, and analytics flows.
- Write links, summary, introduction, related work, system architecture, component descriptions, data/API descriptions, and IEEE references.
- Explain why each service is appropriate and how it is automatically invoked.
- Build a learning log showing new tools, obstacles, decisions, and fixes.
- Prepare a 20-minute primary demo, Q&A notes, and a fallback evidence path.

Exit criteria:

- Every rubric row points to working implementation evidence and a report section.
- The document matches the deployed system exactly.
- The user can explain each flow without reading source code verbatim.

## Phase 8 - Final audit and submission

Required work:

- Run production build, automated tests, smoke tests, security checks, and credential scans.
- Verify live URLs from a clean browser session.
- Remove generated files, local secrets, and unnecessary dependencies.
- Assemble the required ZIP structure: solution document, `doc_images`, `code`, `deploy`, and `data` as applicable.
- Check repository/source links, image references, and IEEE citations.
- Verify the Canvas deadline and demonstration booking.
- Tag the final source revision and retain a backup.

Exit criteria:

- Submission contents pass the rubric checklist and contain no credentials.
- The live demo is rehearsed and recoverable.
- The final archive opens correctly and contains every required item.
