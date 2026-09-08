# CloudSentinel operations and submission checklist

This checklist records the remaining manual console work and the evidence to capture. It deliberately avoids credentials, webhook values, and session links.

## IAM review

- Use the pre-created `LabRole`; do not create new roles in the Learner Lab.
- Confirm Lambda and ECS task definitions use `LabRole` only where the lab requires it.
- Confirm the Scheduler target role is `LabRole` and its trust includes `scheduler.amazonaws.com`.
- Record denied IAM actions as lab constraints; never weaken policies just to make an unrelated service such as SageMaker work.
- Capture policy names and resource settings, not secret values or access keys.

## CloudWatch observability

- Keep `/ecs/cloudsentinel-monitor-worker` retention at one day for the lab.
- Create a Lambda error alarm for `CloudSentinelApi` with a five-minute period and threshold of at least one error.
- Create an ECS worker stopped-task or failure alarm only if the lab exposes the metric without extra permissions.
- Keep alarm actions empty for the demo unless a notification destination is explicitly required.
- Capture the alarm configuration and one successful log stream as evidence.

## API Gateway controls

- Enable CORS only for the deployed S3/CloudFront origin when known; use `*` only for a temporary lab test.
- Add throttling at the stage level (for example, a low steady-state rate and burst suitable for a single-user demo).
- Keep the application body limit at 16 KB and monitor URL limit at 2,048 characters; the API rejects larger values.
- Capture route, integration, CORS, and throttle settings without API keys.

## Cost and teardown

- Stop or delete disposable ECS tasks after evidence capture.
- Disable disposable EventBridge schedules and remove disposable monitors through the application route.
- Keep the ECR repository and final S3 evidence bucket only while required for assessment.
- Before the Learner Lab session ends, record the final Git commit and remove temporary test objects if the rubric allows it.
- Never delete the shared lab role or unrelated tables/buckets.

## Final evidence pack

- Dashboard screenshots for create, run-now, scheduled check, outage/recovery, PageSpeed, and analytics.
- AWS screenshots for Lambda, API Gateway routes, ECS task definition, ECR image, DynamoDB tables, S3 prefixes, Glue crawler/table, Athena query, and CloudWatch logs.
- Redacted output for each API smoke test and the final commit hash.
- Architecture diagram and service-purpose table matching the deployed configuration.
- Final ZIP containing the solution document, `doc_images`, `code`, `deploy`, and `data` folders as required by the assignment.
