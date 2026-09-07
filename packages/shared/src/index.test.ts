import { describe, expect, it } from 'vitest';

import { calculateUptimePercent, getEndpointState, type CheckResult, type MonitoredEndpoint } from './index.js';

const endpoint: MonitoredEndpoint = {
  id: 'endpoint-1',
  name: 'Example',
  url: 'https://example.com',
  intervalMinutes: 15,
  enabled: true,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

describe('shared monitoring calculations', () => {
  it('reports unknown before the first check', () => {
    expect(getEndpointState(endpoint)).toBe('UNKNOWN');
  });

  it('calculates uptime from completed checks', () => {
    const results: CheckResult[] = [
      { endpointId: endpoint.id, checkedAt: endpoint.createdAt, state: 'UP', source: 'MANUAL', responseTimeMs: 100, statusCode: 200 },
      { endpointId: endpoint.id, checkedAt: endpoint.createdAt, state: 'UP', source: 'SCHEDULED', responseTimeMs: 120, statusCode: 204 },
      { endpointId: endpoint.id, checkedAt: endpoint.createdAt, state: 'DOWN', source: 'SCHEDULED', responseTimeMs: 1000, statusCode: 503 },
    ];

    expect(calculateUptimePercent(results)).toBe(66.67);
  });

  it('returns null when no observations exist', () => {
    expect(calculateUptimePercent([])).toBeNull();
  });
});

