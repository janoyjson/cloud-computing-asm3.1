import { describe, expect, it } from 'vitest';

import { addMockEndpoint, applyMockCheck, initialEndpoints } from './mock-cloudsentinel.js';

describe('local CloudSentinel workflow', () => {
  it('adds a monitor before it has a check result', () => {
    const endpoints = addMockEndpoint(
      initialEndpoints,
      { name: 'New API', url: 'https://new.example.com/health', intervalMinutes: 15 },
      'new-api',
      '2026-08-26T03:00:00.000Z',
    );

    expect(endpoints[0]).toMatchObject({ id: 'new-api', name: 'New API', enabled: true });
    expect(endpoints[0]?.latestCheck).toBeUndefined();
  });

  it('applies an immediate check to the selected monitor', () => {
    const { endpoints, result } = applyMockCheck(
      initialEndpoints,
      'orders-api',
      '2026-08-26T03:05:00.000Z',
    );

    expect(result).toMatchObject({ state: 'UP', source: 'MANUAL', statusCode: 200 });
    expect(endpoints.find((endpoint) => endpoint.id === 'orders-api')?.latestCheck).toEqual(result);
  });
});

