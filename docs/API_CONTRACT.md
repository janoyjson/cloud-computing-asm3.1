# CloudSentinel API contract

Base path: `/v1`

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
- Production validation in Phase 3 must also block private, loopback, link-local, and metadata destinations.

## Planned contracts

| Method | Path | Purpose | Target phase |
|---|---|---|---|
| `GET` | `/endpoints/{id}` | Read monitor details | 2 |
| `PATCH` | `/endpoints/{id}` | Change monitor and schedule | 2/3 |
| `DELETE` | `/endpoints/{id}` | Remove monitor and schedule | 2/3 |
| `POST` | `/endpoints/{id}/checks` | Start an ECS check immediately | 3 |
| `GET` | `/endpoints/{id}/checks` | Read recent check results | 3 |
| `GET` | `/endpoints/{id}/incidents` | Read incident history | 4 |
| `POST` | `/endpoints/{id}/performance` | Start PageSpeed analysis | 5 |
| `GET` | `/endpoints/{id}/performance` | Read performance history | 5 |
| `GET` | `/analytics/overview` | Run/read Athena dashboard analytics | 5 |

Long-running operations return `202 Accepted` with an operation or task identifier. The dashboard polls the appropriate read endpoint instead of holding API Gateway requests open.

