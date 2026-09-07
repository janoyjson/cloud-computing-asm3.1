# CloudSentinel manual AWS setup

This guide records the AWS Management Console settings used for the Learner Lab. Resources are created manually so the student can explain every setting. Application operations must still invoke the services automatically; Console test data is setup evidence only.

## Confirmed Learner Lab constraints

- Use `us-east-1` for every regional resource.
- Use the pre-created `LabRole`; normal IAM user, group, and role creation is restricted.
- Lambda is limited to 10 concurrent execution environments.
- ECR allows Console writes, while `LabRole` has read-only access.
- ECS task role and task execution role must both be `LabRole`.
- Glue uses `G.1X` or `Standard`, at most 10 workers, and concurrency 1.
- CloudFront and EventBridge Scheduler are not named in the allowed-service list and require a permission test before becoming dependencies.

## Phase 2 DynamoDB tables

All tables use Standard table class, on-demand capacity, AWS-owned encryption, no secondary indexes, and deletion protection off for the lab.

| Table | Partition key | Sort key | Status |
|---|---|---|---|
| `CloudSentinelMonitors` | `id` (String) | None | Created manually |
| `CloudSentinelChecks` | `endpointId` (String) | `checkedAt` (String) | Created manually |
| `CloudSentinelIncidents` | `endpointId` (String) | `openedAt` (String) | Created manually |

The performance table is deferred to Phase 5.

## Phase 2 Lambda function

Create the function only after the Lambda package has passed its local tests.

1. Open Lambda in `us-east-1` and choose **Create function**.
2. Choose **Author from scratch**.
3. Set function name to `CloudSentinelApi`.
4. Select the Node.js 22.x runtime and x86_64 architecture.
5. Under permissions, choose **Use an existing role**, then select `LabRole`.
6. Create the function.
7. In **Code source**, choose **Upload from** -> **.zip file** and upload `artifacts/cloudsentinel-api.zip`.
8. In **Runtime settings**, set the handler to `index.handler`.
9. Under **Configuration** -> **Environment variables**, add `MONITORS_TABLE_NAME=CloudSentinelMonitors`.
10. Under **General configuration**, use 256 MB memory and a 10-second timeout.

Run these direct Lambda test events before creating API Gateway:

```json
{"routeKey":"GET /v1/health"}
```

Expected status: `200`, with `{"status":"ok","phase":2}` in the response body.

```json
{"routeKey":"GET /v1/endpoints"}
```

Expected status: `200`, with the DynamoDB monitor items in the response body.

```json
{
  "routeKey": "POST /v1/endpoints",
  "body": "{\"name\":\"Lambda deployment test\",\"url\":\"https://example.com/\",\"intervalMinutes\":15}"
}
```

Expected status: `201`. Confirm that the returned ID appears as a new item in `CloudSentinelMonitors`. This proves Lambda wrote the record rather than the Console.

## Rebuilding the Lambda package

From the workspace root on Windows:

```powershell
pnpm --filter @cloudsentinel/api package:lambda
```

The generated upload file is `artifacts/cloudsentinel-api.zip`. It contains `index.js` and `package.json` at the ZIP root.

Never place AWS credentials, account IDs, session tokens, or Learner Lab access links in this repository.

## Phase 3 results bucket

Create a second, private S3 general purpose bucket in `us-east-1`. Use a globally unique name beginning with `cloudsentinel-results-`.

- Keep all Block Public Access settings enabled.
- Keep ACLs disabled.
- Use SSE-S3 default encryption.
- Leave versioning disabled in the Learner Lab.
- Add the existing `Project`, `Environment`, and `Phase=3` tags.
- Do not enable static website hosting or add a public bucket policy.

The worker stores JSON under partitioned keys such as:

```text
checks/year=2026/month=09/day=02/endpointId=<id>/<timestamp>.json
```

This structure is designed for the Glue and Athena work in Phase 5.

## Phase 3 ECR repository

In the `us-east-1` ECR Console, create a private repository with:

| Setting | Value |
|---|---|
| Repository name | `cloudsentinel-monitor-worker` |
| Tag mutability | Immutable |
| Encryption | AES-256 |
| Repository policy | None |

Use versioned image tags such as `0.2.0`; do not use `latest` with immutable tags.

## Local container prerequisites

The Windows development machine currently has no WSL, Docker, Podman, or AWS CLI. Before pushing an image:

1. Install or update WSL 2 and restart Windows if requested.
2. Install Docker Desktop using the WSL 2 Linux-container backend.
3. Install AWS CLI v2 and refresh the `cloudsentinel-lab` profile for the active Learner Lab session.
4. Verify `wsl --version`, `docker version`, and `aws sts get-caller-identity --profile cloudsentinel-lab`.

Build the image from the workspace root so the Dockerfile can access the workspace packages:

```powershell
docker build -f services/monitor-worker/Dockerfile -t cloudsentinel-monitor-worker:0.2.0 .
```

Open the ECR repository and choose **View push commands**. Use the displayed registry URI and add `--profile cloudsentinel-lab` to the AWS login command. Do not copy the Learner Lab credentials directly into a Docker command or repository file.
