# CloudSentinel API contract

Base path: `/v1`

When `API_ACCESS_TOKEN` is configured, all routes except health require `Authorization: Bearer <token>`. This is a single-user/demo access guard; production multi-user authentication should use a managed identity provider such as Amazon Cognito.

All success and error bodies use JSON. Errors follow:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A safe user-facing explanation"
  }
}
```

## Phase 1 implemented contracts

### `GET /health`

Returns service status and phase identifier.

### `GET /endpoints`

Returns:

```json
{
  "items": []
}
```

### `POST /endpoints`

Request:

```json
{
  "name": "Client API",
  "url": "https://api.example.com/health",
  "intervalMinutes": 15
}
```

Validation rules:

- Name is required and limited to 80 characters.
- URL must be absolute and use HTTP or HTTPS.
- Interval must be one of 5, 15, 30, or 60 minutes.
- API validation resolves every hostname and blocks private, loopback, link-local, metadata, multicast, and IPv6 unique-local destinations before persistence.

After the endpoint record is stored, the API creates its EventBridge Scheduler schedule. If schedule creation fails, the API removes the new endpoint record and returns a safe internal error.

## Phase 3 implemented contracts

### `POST /endpoints/{id}/checks`

Starts one Fargate monitoring task for the persisted endpoint. Endpoint ID and URL are passed as task-specific container overrides. Returns `202 Accepted`:

```json
{
  "taskArn": "arn:aws:ecs:region:account:task/cluster/task-id",
  "status": "STARTED"
}
```

The client polls `GET /endpoints` until the worker updates the endpoint's `latestCheck` value.

### `PATCH /endpoints/{id}`

Updates any supplied mutable fields and then updates the corresponding recurring schedule:

```json
{
  "intervalMinutes": 30,
  "enabled": false
}
```

`name`, `url`, `intervalMinutes`, and `enabled` are optional. Disabling an endpoint changes its schedule state to `DISABLED`; changing its interval or URL replaces the schedule configuration.

### `DELETE /endpoints/{id}`

Deletes the recurring schedule before deleting the DynamoDB endpoint record. Returns:

```json
{
  "id": "endpoint-id",
  "status": "DELETED"
}
```

## Phase 5 implemented contracts

### `POST /endpoints/{id}/performance`

Starts a mobile Google PageSpeed Insights analysis for the endpoint URL, persists the result in `CloudSentinelPerformance`, and returns `201 Created` with the stored result:

```json
{
  "endpointId": "endpoint-id",
  "measuredAt": "2026-09-08T00:00:00.000Z",
  "strategy": "MOBILE",
  "performanceScore": 91,
  "accessibilityScore": 88,
  "bestPracticesScore": 77,
  "seoScore": 100,
  "firstContentfulPaintMs": 1234.56,
  "largestContentfulPaintMs": 2345.67,
  "cumulativeLayoutShift": 0.12
}
```

The operation is synchronous and protected by a 25-second upstream timeout. The deployed Lambda timeout must therefore be at least 30 seconds. `PAGESPEED_API_KEY` is optional.

### `GET /endpoints/{id}/performance`

Returns the newest persisted PageSpeed results first:

```json
{
  "items": []
}
```

### `GET /endpoints/{id}/incidents`

Returns the newest outage and recovery records for the endpoint, up to the latest 20 items:

```json
{
  "items": [
    {
      "id": "incident-id",
      "endpointId": "endpoint-id",
      "openedAt": "2026-09-08T00:00:00.000Z",
      "recoveredAt": "2026-09-08T00:05:00.000Z",
      "status": "RESOLVED"
    }
  ]
}
```

### `GET /analytics/overview`

Runs the Athena checks query for the requested ISO-8601 range. If `from` and `to` are omitted, Lambda uses the previous 24 hours. The response includes check totals, uptime, average response time, and incident count:

```json
{
  "from": "2026-09-07T00:00:00.000Z",
  "to": "2026-09-08T00:00:00.000Z",
  "totalChecks": 4,
  "upChecks": 3,
  "downChecks": 1,
  "uptimePercent": 75,
  "averageResponseTimeMs": 120.5,
  "incidentCount": 1
}
```

## Planned contracts

| Method | Path | Purpose | Target phase |
|---|---|---|---|
| `GET` | `/endpoints/{id}` | Read monitor details | 2 |
| `GET` | `/endpoints/{id}/checks` | Read recent check results | 3 |

Long-running operations return `202 Accepted` with an operation or task identifier. The dashboard polls the appropriate read endpoint instead of holding API Gateway requests open.

