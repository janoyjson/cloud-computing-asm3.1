# CloudSentinel

CloudSentinel is a deployment health monitoring platform for freelance developers, small teams, and cloud engineering learners. It monitors websites and APIs, records availability and latency, detects incidents, sends notifications, and exposes historical analytics.

This repository is a rubric-aligned Assessment 3 implementation. The original assignment documents remain unchanged in `AsmDocs/`.

## Current status

Phase 1 is complete. Phase 2 is in progress using manually created Learner Lab resources so every AWS setting can be explained:

- React and TypeScript dashboard with a local mock workflow
- Shared endpoint, check-result, and incident contracts
- API Gateway/Lambda-compatible API handler and in-memory repository
- ECS-ready HTTP monitoring worker and Dockerfile
- AWS CDK v2 infrastructure workspace
- Architecture, API, roadmap, and rubric-traceability documentation
- Unit tests, linting, type checking, and production builds
- Active DynamoDB monitor, check, and incident tables in `us-east-1`
- DynamoDB-backed Lambda API package ready for manual Console upload

Verified on 26 August 2026: lint, type checks, 11 unit tests, all workspace builds, CDK synthesis, and the browser-based add/run-check workflow passed.

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

The dashboard runs at `http://localhost:5173` and uses local mock data during Phase 1.

Run the full verification suite:

```bash
pnpm check
```

No AWS credentials are required until Phase 2. Never commit credentials, API keys, webhook URLs, or `.env` files.
