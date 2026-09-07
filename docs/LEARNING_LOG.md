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
- Reworked the Dockerfile to copy a bundled runtime into a smaller Node.js 22 image without development dependencies.
- Confirmed that the local computer still requires WSL, Docker Desktop, and AWS CLI before an ECR push can be performed.
