# CloudSentinel learning log

This is a factual engineering log to support the assessment's skill-development evidence. The student should add personal explanations, screenshots, obstacles, and reflections after performing or reviewing each activity; it should not be submitted as a claim of learning without that review.

## 26 August 2026 - Phase 1 foundation

### Assignment and architecture analysis

- Read the current assignment brief, rubric, proposal, and all three sample reports.
- Identified the six required AWS categories: Compute, Containers, Storage, Networking and Content Delivery, Database, and Analytics.
- Converted the CloudSentinel proposal into five assessable user journeys and separated optional features from the MVP.
- Used the sample reports to establish that the final diagram must show every client operation and scheduled event invoking downstream services.

### Toolchain decisions

- Selected a pnpm workspace so the frontend, Lambda API, ECS worker, shared contracts, and CDK infrastructure can be checked together.
- Selected React with Vite for a static frontend suitable for S3 and CloudFront.
- Selected AWS CDK v2 with TypeScript for repeatable infrastructure definitions, subject to confirmation that the Learner Lab permits the required CloudFormation/IAM actions.
- Selected Node.js 24 for local development and future Lambda compatibility.

### Compatibility issue and resolution

- Initial dependency resolution selected TypeScript 7.0.2.
- The current `typescript-eslint` release rejected TypeScript 7 and declared support below TypeScript 6.1.
- Pinned TypeScript to 6.0.3, reinstalled dependencies, and confirmed that the peer-dependency check and ESLint both passed.

### Verification evidence

- Lint passed.
- All workspace type checks passed.
- Eleven unit tests passed across shared logic, API validation, HTTP-check behavior, and the local web workflow.
- Shared, API, worker, infrastructure, and frontend builds passed.
- CDK synthesis generated a valid foundation template without deploying resources.
- Browser testing verified endpoint creation and immediate mock checks with no console errors.
- Docker was not available on this machine, so an actual image build must be verified before or during Phase 3.

### Student review prompts

Before continuing, be able to explain:

1. Why a monorepo and shared types reduce integration errors.
2. Why ECS Fargate is used for monitoring jobs while Lambda handles short API operations.
3. Why an AWS service only counts when the application invokes it automatically.
4. Why the first CDK stack intentionally contains no resources.
5. How the TypeScript/ESLint compatibility problem was detected and fixed.

## 2 September 2026 - Phase 2 manual AWS foundation

### Learner Lab discovery

- Confirmed that regional service access is limited to `us-east-1` and `us-west-2`; selected `us-east-1` for consistency.
- Confirmed that normal IAM role creation is restricted and that deployed Lambda and ECS resources must use the pre-created `LabRole`.
- Identified that CloudFront and EventBridge Scheduler are not separately named in the allowed-service list, so they require permission tests and fallback designs.
- Chose manual Management Console provisioning instead of CDK so every resource setting can be demonstrated and explained.

### DynamoDB foundation

- Manually created the monitors, checks, and incidents tables with on-demand capacity.
- Used a single partition key for monitor configuration and composite partition/sort keys for time-ordered check and incident history.
- Added manual test records to verify the schemas, while preserving the requirement that the final application must invoke DynamoDB automatically.

### API deployment preparation

- Added a DynamoDB-backed endpoint repository while retaining the in-memory implementation for isolated tests.
- Bundled the AWS SDK with the Lambda code to avoid relying on an unspecified runtime SDK version.
- Added a reproducible Lambda ZIP build and direct Lambda test events for health, read, and write verification.

### Deployed Phase 2 workflow

- Created an HTTP API with explicit health, list, and create routes backed by the Lambda function.
- Verified direct HTTPS health, DynamoDB reads, and DynamoDB writes through API Gateway.
- Hosted the React production build as an S3 website and verified that the browser loads persistent monitors from AWS.
- Corrected a browser compatibility issue by binding `fetch` to `window`, rebuilt the frontend, and verified the fix against the live API.

### Phase 3 worker preparation

- Added public-destination validation for initial URLs and every redirect, redirect limits, timeouts, and a named monitoring user agent.
- Added DynamoDB check-result writes, atomic latest-state updates, and partitioned JSON storage in S3.
- Changed endpoint downtime into a successfully stored business result; only worker or persistence failures should fail the ECS task.
- Reworked the Dockerfile to copy a bundled runtime into a smaller Node.js 24 image without development dependencies.
- Identified WSL, Docker Desktop, and AWS CLI as prerequisites for publishing the worker to ECR.

## 7 September 2026 - Phase 3 container publishing

### Container compatibility fixes

- Added a root `.dockerignore` so Windows workspace dependencies cannot overwrite Linux dependencies installed during the image build.
- Matched the image runtime to the project's Node.js 24 requirement.
- Changed the bundled entry point to CommonJS and wrapped startup in an async `main()` so the AWS SDK can load Node.js built-ins correctly.
- Verified that the image runs as the non-root `node` user and rejects startup when required task environment variables are absent.

### Docker Desktop recovery

- Diagnosed Docker Desktop startup failures from backend logs rather than using the destructive factory-reset option.
- Isolated inaccessible Windows AF_UNIX sockets by preserving and replacing their parent runtime directories.
- Disabled the optional Docker AI component that immediately recreated the failing `sailor-ingest.sock` socket.
- Confirmed that the normal Linux container engine starts successfully after the recovery.

### ECR evidence

- Authenticated Docker to the Learner Lab ECR registry without placing credentials in commands or repository files.
- Published the tested `cloudsentinel-monitor-worker:0.2.0` image to the immutable ECR repository.
- Verified the tag, digest, push timestamp, and approximately 58.8 MB compressed image size through the ECR API.

### First Fargate execution

- Created the ECS cluster, Fargate task definition, outbound-only worker security group, and one-day CloudWatch log group manually.
- Ran one public-subnet task with a public IP because the Learner Lab VPC has no NAT gateway or private service endpoints.
- Confirmed exit code `0` and an HTTP `200` availability result for the controlled test endpoint.
- Verified the same check timestamp and values in CloudWatch Logs, `CloudSentinelChecks`, the monitor's `latestCheck`, and an SSE-S3 encrypted partitioned object.

### Automated "Run now" implementation

- Added an API task-launcher that reads a monitor from DynamoDB and calls ECS `RunTask` with endpoint-specific container overrides.
- Added the `POST /v1/endpoints/{id}/checks` route with safe not-found and internal-error responses.
- Connected the dashboard button to the API and poll-based status refresh so a completed Fargate result appears without a full page reload.
- Added unit tests for ECS request construction, placement failures, endpoint lookup, the API route, and the browser client.
- Uploaded the updated Lambda bundle and attached the new API Gateway route to `CloudSentinelApi` with invoke permission enabled.
- Verified that the live POST route returned a Fargate task ARN and that the task completed with exit code `0`.
- Matched the API-started task's timestamp and result across CloudWatch Logs, `CloudSentinelChecks`, the monitor's latest state, and the AES256-encrypted S3 evidence object.
- Detected and corrected an initially unattached API Gateway route before accepting the deployment as complete.
- Deployed the API-configured frontend build to the S3 website and verified that its "Run check" button updated the selected monitor to `UP` through the complete AWS workflow.

### Recurring schedule implementation

- Confirmed that the Learner Lab permits EventBridge Scheduler reads in `us-east-1` and that `LabRole` trusts `scheduler.amazonaws.com`.
- Added deterministic EventBridge schedule names and an ECS `RunTask` target with the same Fargate networking used by immediate checks.
- Passed endpoint-specific ID and URL overrides with `MONITOR_SOURCE=SCHEDULED` so worker evidence distinguishes recurring runs from dashboard runs.
- Connected endpoint creation, updates, enable/disable state, and deletion to the corresponding schedule lifecycle.
- Preserved worker-owned `latestCheck` data by updating only mutable endpoint fields in DynamoDB.
- Deployed the scheduler-enabled Lambda and created a five-minute monitor through the S3-hosted dashboard.
- Verified that the application-created schedule targeted the expected cluster, task definition, subnet, security group, public-IP setting, and `LabRole` without manual schedule creation.
- Confirmed the first automatic task exited successfully and matched one `UP`, `SCHEDULED` result across CloudWatch Logs, DynamoDB, and an AES256-encrypted S3 object.

## 7 September 2026 - Phase 4 incident foundation

- Created the Discord webhook secret manually in Secrets Manager and validated only its structure without printing the protected URL.
- Defined explicit transitions: first failure opens, repeated failures do nothing, and the first successful check after failure resolves the incident.
- Added conditional incident creation and recovery persistence in `CloudSentinelIncidents`.
- Added Discord delivery through a five-second timeout, disabled mentions, and a strict Discord HTTPS destination allowlist.
- Recorded notification delivery success or failure on each incident while preserving the completed monitoring result.
- Built the tested Node.js 24 worker image as immutable version `0.3.0` for manual ECR publication.
- Deployed revision 3 manually and verified the complete incident workflow in AWS: outage alert, duplicate suppression, recovery alert, and incident closure.
- Confirmed that a worker task remains successful (`exit 0`) when the monitored endpoint is down because availability failure is stored as a business result rather than treated as infrastructure failure.

## 8 September 2026 - Phase 5 performance foundation

- Added a PageSpeed Insights client that requests all four Lighthouse dashboard categories in one mobile analysis and converts normalized scores into readable percentages.
- Persisted timestamped scores and selected Core Web Vitals in the manually created `CloudSentinelPerformance` DynamoDB table.
- Added API Gateway/Lambda contracts for starting and listing performance measurements, with the dashboard invoking the POST route through an explicit PageSpeed button.
- Added deterministic tests around repeated query parameters, upstream HTTP errors, DynamoDB composite-key queries, API behavior, and browser URL encoding.
- Identified the deployment-specific timeout requirement: the Lambda must allow at least 30 seconds for the synchronous PageSpeed request.

### Analytics foundation

- Added an Athena query adapter that starts a query, polls its execution state, parses aggregate rows, and fails safely on timeout or query failure.
- Combined S3 historical check analytics with a DynamoDB incident count so the dashboard can show uptime, latency, and incident totals through one Lambda route.
- Documented the Glue crawler naming and lower-case JSON field assumptions required for the manually provisioned catalog.
