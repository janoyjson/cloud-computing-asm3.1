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

The Windows development machine uses WSL 2, Docker Desktop, and AWS CLI v2. Before pushing an image from a new session:

1. Install or update WSL 2 and restart Windows if requested.
2. Install Docker Desktop using the WSL 2 Linux-container backend.
3. Install AWS CLI v2 and refresh the `cloudsentinel-lab` profile for the active Learner Lab session.
4. Verify `wsl --version`, `docker version`, and `aws sts get-caller-identity --profile cloudsentinel-lab`.

Build the image from the workspace root so the Dockerfile can access the workspace packages:

```powershell
docker build -f services/monitor-worker/Dockerfile -t cloudsentinel-monitor-worker:0.2.0 .
```

Open the ECR repository and choose **View push commands**. Use the displayed registry URI and add `--profile cloudsentinel-lab` to the AWS login command. Do not copy the Learner Lab credentials directly into a Docker command or repository file.

## Phase 3 ECS Fargate resources

Create these resources manually in `us-east-1`:

- CloudWatch log group `/ecs/cloudsentinel-monitor-worker` with one-day retention.
- ECS Fargate cluster `cloudsentinel-cluster` without EC2 capacity.
- Outbound-only security group `cloudsentinel-worker-sg` in the Learner Lab VPC.
- Fargate task definition family `cloudsentinel-monitor-worker`, using Linux/X86_64, 0.25 vCPU, 0.5 GB, and `LabRole` for both task roles.

The task definition container uses the versioned ECR image, the `awslogs` driver, and these shared environment variables:

```text
MONITORS_TABLE_NAME=CloudSentinelMonitors
CHECKS_TABLE_NAME=CloudSentinelChecks
RESULTS_BUCKET_NAME=<results-bucket-name>
MONITOR_SOURCE=MANUAL
```

For the controlled manual test only, add a real monitor ID and its matching public URL. Run one task in the public subnet, select the outbound-only security group, and enable a public IP. A successful one-shot worker is expected to stop with exit code `0`.

Verify the matching result in CloudWatch Logs, `CloudSentinelChecks`, `CloudSentinelMonitors.latestCheck`, and the partitioned S3 object before connecting Lambda.

## Phase 3 Lambda "Run now" deployment

Rebuild and upload `artifacts/cloudsentinel-api.zip`, then add these Lambda environment variables using the actual console resource IDs:

```text
ECS_CLUSTER=cloudsentinel-cluster
ECS_TASK_DEFINITION=cloudsentinel-monitor-worker:2
ECS_SUBNET_IDS=<public-subnet-id>
ECS_SECURITY_GROUP_IDS=<worker-security-group-id>
ECS_CONTAINER_NAME=monitor-worker
ECS_ASSIGN_PUBLIC_IP=true
```

Keep `MONITORS_TABLE_NAME=CloudSentinelMonitors`. In API Gateway, add `POST /v1/endpoints/{id}/checks` to the existing Lambda integration and redeploy if the selected stage does not auto-deploy.

## Phase 3 EventBridge Scheduler deployment

The Learner Lab Scheduler list API succeeds in `us-east-1`, and the pre-created `LabRole` trust policy includes `scheduler.amazonaws.com`. Do not manually create one schedule per endpoint: the Lambda application must own that lifecycle.

Rebuild and upload `artifacts/cloudsentinel-api.zip`. Keep the earlier environment variables and add:

```text
ECS_CLUSTER_ARN=<cluster ARN copied from the ECS cluster details page>
ECS_TASK_DEFINITION_ARN=<full ARN for cloudsentinel-monitor-worker revision 2>
SCHEDULER_EXECUTION_ROLE_ARN=<full ARN for LabRole>
SCHEDULER_GROUP_NAME=default
```

In API Gateway, attach these routes to the existing `CloudSentinelApi` Lambda integration with invoke permission enabled:

```text
PATCH /v1/endpoints/{id}
DELETE /v1/endpoints/{id}
```

The existing `POST /v1/endpoints` route now creates both the DynamoDB monitor and its recurring schedule. Create a new five-minute monitor through the dashboard, then open Amazon EventBridge Scheduler and verify:

- The schedule name begins with `cloudsentinel-` and ends with the monitor ID.
- The schedule is enabled and uses `rate(5 minutes)` with flexible time window disabled.
- Its target is ECS `RunTask` on `cloudsentinel-cluster` using Fargate, the worker task definition, public subnet, outbound-only security group, and public IP.
- The target input overrides the endpoint ID, URL, and `MONITOR_SOURCE=SCHEDULED`.
- `LabRole` is the schedule execution role.

Wait for the first invocation, then verify a new task with `MONITOR_SOURCE=SCHEDULED` in CloudWatch Logs and matching DynamoDB/S3 evidence. Use the PATCH route to disable or change the interval and verify the schedule changes; use DELETE only on a disposable test monitor and verify its schedule is removed.

## Phase 4 incidents and Discord notifications

Create a Discord incoming webhook for the alert channel, then store it in Secrets Manager in `us-east-1` rather than in source code, task-definition plaintext, or shell history:

```text
Secret name: cloudsentinel/discord-webhook
Secret JSON key: url
Encryption: aws/secretsmanager
Rotation: disabled for the Learner Lab
```

Publish the locally tested `cloudsentinel-monitor-worker:0.3.0` image to the existing immutable ECR repository. Create task-definition revision 3 from revision 2, change the image tag to `0.3.0`, and add:

```text
INCIDENTS_TABLE_NAME=CloudSentinelIncidents
NOTIFICATION_SECRET_ID=cloudsentinel/discord-webhook
```

Keep the existing monitor, check, results-bucket, logging, role, CPU, memory, and networking settings. Update Lambda's `ECS_TASK_DEFINITION` and `ECS_TASK_DEFINITION_ARN` values to revision 3. Existing EventBridge schedules receive the new revision after the corresponding endpoint is patched; newly created endpoints use it immediately.
