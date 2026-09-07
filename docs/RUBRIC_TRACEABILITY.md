# Rubric traceability plan

This file is an evidence plan, not a prediction or guarantee of marks. A service should only be claimed when it is appropriate, fully implemented, and automatically invoked by the application.

| Rubric area | Planned evidence | Delivery phase |
|---|---|---|
| Project idea and technologies (2) | Proposal, MVP boundary, architecture decision record, service-purpose table | 1 and 7 |
| Learning new tools (3) | Dated learning log covering CDK, ECS, scheduling, DynamoDB, Glue/Athena, failures, and fixes | Every phase |
| Compute | Lambda functions invoked by API Gateway and application workflows | 2-5 |
| Containers | ECS Fargate worker invoked by "Run now" and EventBridge Scheduler | 3 |
| Storage | S3 frontend assets and historical check/performance results | 2, 3, and 5 |
| Networking and content delivery | CloudFront application delivery and API Gateway client APIs | 2 |
| Database | DynamoDB monitor, check, incident, and performance records | 2-5 |
| Analytics | Glue catalog over S3 plus Athena queries invoked from the dashboard | 5 |
| External API 1 | PageSpeed Insights performance workflow | 5 |
| External API 2 | Notification webhook for outage/recovery transitions | 4 |
| Summary (0.5) | Concise objective, users, deployed scope, and service overview | 7 |
| Introduction (1) | Motivation, high-level behavior, and beneficiaries | 7 |
| Related work (1) | Comparison with focused uptime-monitoring platforms using cited sources | 7 |
| System architecture (5) | Detailed diagrams for every client and scheduled operation, with functions and arrows | 7 |
| System descriptions (1) | Purpose, selection rationale, and invocation evidence for each component | 7 |
| Data structures/APIs (1) | DynamoDB keys, S3 partitions, request/response examples, and external API data | 7 |
| References (0.5) | IEEE references in code comments where required and in the document | Every phase and 7 |

## Evidence captured during implementation

For each service, retain:

- The user action or event that invokes it.
- Relevant application screenshot.
- AWS resource/configuration screenshot without secrets.
- CloudWatch log or stored output proving execution.
- Source-code location implementing the invocation.
- A short explanation of why the service is appropriate.
- Test or controlled demo case proving failure handling.

