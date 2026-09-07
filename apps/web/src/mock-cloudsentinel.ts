import {
  type CheckResult,
  type CreateEndpointInput,
  type MonitoredEndpoint,
} from '@cloudsentinel/shared';

const baseTime = '2026-08-26T02:15:00.000Z';

export const initialEndpoints: MonitoredEndpoint[] = [
  {
    id: 'customer-portal',
    name: 'Customer portal',
    url: 'https://portal.example.com',
    intervalMinutes: 5,
    enabled: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    latestCheck: {
      endpointId: 'customer-portal',
      checkedAt: '2026-08-26T02:14:42.000Z',
      state: 'UP',
      source: 'SCHEDULED',
      responseTimeMs: 184,
      statusCode: 200,
    },
  },
  {
    id: 'orders-api',
    name: 'Orders API',
    url: 'https://api.example.com/orders/health',
    intervalMinutes: 15,
    enabled: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    latestCheck: {
      endpointId: 'orders-api',
      checkedAt: '2026-08-26T02:11:18.000Z',
      state: 'DOWN',
      source: 'SCHEDULED',
      responseTimeMs: 10003,
      statusCode: 503,
      error: 'Service unavailable',
    },
  },
  {
    id: 'docs-site',
    name: 'Documentation',
    url: 'https://docs.example.com',
    intervalMinutes: 30,
    enabled: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    latestCheck: {
      endpointId: 'docs-site',
      checkedAt: '2026-08-26T02:01:04.000Z',
      state: 'UP',
      source: 'SCHEDULED',
      responseTimeMs: 96,
      statusCode: 200,
    },
  },
];

export const initialChecks = initialEndpoints
  .map((endpoint) => endpoint.latestCheck)
  .filter((result): result is CheckResult => result !== undefined);

export function addMockEndpoint(
  endpoints: readonly MonitoredEndpoint[],
  input: CreateEndpointInput,
  id: string,
  timestamp: string,
): MonitoredEndpoint[] {
  const endpoint: MonitoredEndpoint = {
    id,
    name: input.name.trim(),
    url: new URL(input.url).toString(),
    intervalMinutes: input.intervalMinutes,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return [endpoint, ...endpoints];
}

export function applyMockCheck(
  endpoints: readonly MonitoredEndpoint[],
  endpointId: string,
  checkedAt: string,
): { endpoints: MonitoredEndpoint[]; result: CheckResult } {
  const endpoint = endpoints.find((candidate) => candidate.id === endpointId);
  if (!endpoint) {
    throw new Error('Endpoint not found.');
  }

  const result: CheckResult = {
    endpointId,
    checkedAt,
    state: 'UP',
    source: 'MANUAL',
    responseTimeMs: 128,
    statusCode: 200,
  };

  return {
    result,
    endpoints: endpoints.map((candidate) => (
      candidate.id === endpointId
        ? { ...candidate, latestCheck: result, updatedAt: checkedAt }
        : candidate
    )),
  };
}

