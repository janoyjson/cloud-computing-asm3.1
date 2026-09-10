# CloudSentinel

CloudSentinel is a deployment health monitoring platform for freelance developers, small teams, and cloud engineering learners. It monitors websites and APIs, records availability and latency, detects incidents, sends notifications, and exposes historical analytics.

This repository is a rubric-aligned Assessment 3 implementation. The original assignment documents remain unchanged in `AsmDocs/`.

## Current status

Phases 1–4 are implemented, with Phase 5 analytics/performance deployment and final evidence being completed using manually created Learner Lab resources so every AWS setting can be explained:

- React and TypeScript dashboard with local fallback and AWS-connected workflows
- Shared endpoint, check-result, and incident contracts
- API Gateway/Lambda API handler with DynamoDB persistence
- ECS Fargate HTTP monitoring worker and Dockerfile
- AWS CDK v2 infrastructure workspace
- Architecture, API, roadmap, and rubric-traceability documentation
- Unit tests, linting, type checking, and production builds
- Active DynamoDB monitor, check, and incident tables in `us-east-1`
- DynamoDB-backed account registration/sign-in with signed JWT sessions protecting the AWS routes
- DynamoDB-backed Lambda API package ready for manual Console upload

Verified locally on 9 September 2026: lint, type checks, 72 unit tests, all workspace builds, and browser-based create/check workflows passed. AWS smoke tests require a current Learner Lab session.

See [the complete roadmap](docs/ROADMAP.md) and [architecture decisions](docs/ARCHITECTURE.md).
The exact Console settings and deployment tests are recorded in [the manual AWS setup guide](docs/MANUAL_AWS_SETUP.md).

## Workspace layout

```text
apps/web/                 React dashboard
packages/shared/          Shared domain contracts and calculations
services/api/             Lambda-compatible API service
services/monitor-worker/  Containerized endpoint checker
infrastructure/           AWS CDK application
docs/                     Architecture and assessment evidence planning
AsmDocs/                  Original coursework source material
```

## Local development

Requirements: Node.js 24+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

The dashboard runs at `http://localhost:5173`. Leave `VITE_API_BASE_URL` empty for local demo data, or provide the deployed HTTPS API URL to use AWS. In AWS mode, the browser registers/signs in through `/v1/auth` and sends the signed JWT as a bearer token. User ownership is derived from the token subject, so each account sees only its own monitored endpoints.

Run the full verification suite:

```bash
pnpm check
```

Never commit credentials, API keys, webhook URLs, access tokens, or `.env` files.
