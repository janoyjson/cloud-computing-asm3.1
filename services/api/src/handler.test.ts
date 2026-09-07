import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

import { EndpointStore } from './endpoint-store.js';
import { createHandler } from './handler.js';

function event(routeKey: string, body?: string): APIGatewayProxyEventV2 {
  return { routeKey, body } as APIGatewayProxyEventV2;
}

function responseBody(response: unknown): string {
  if (typeof response !== 'object' || response === null || !('body' in response)) {
    return '';
  }

  return typeof response.body === 'string' ? response.body : '';
}

describe('API handler', () => {
  it('returns the Phase 2 health response without opening the repository', async () => {
    const getStore = vi.fn();
    const response = await createHandler(getStore)(event('GET /v1/health'), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(responseBody(response))).toEqual({ status: 'ok', phase: 2 });
    expect(getStore).not.toHaveBeenCalled();
  });

  it('creates and lists endpoints through the injected repository', async () => {
    const store = new EndpointStore([], {
      createId: () => 'endpoint-123',
      now: () => new Date('2026-09-02T01:30:00.000Z'),
    });
    const handler = createHandler(() => store);

    const created = await handler(event('POST /v1/endpoints', JSON.stringify({
      name: 'Example',
      url: 'https://example.com',
      intervalMinutes: 15,
    })), {} as never, vi.fn());
    const listed = await handler(event('GET /v1/endpoints'), {} as never, vi.fn());

    expect(created).toMatchObject({ statusCode: 201 });
    expect(JSON.parse(responseBody(listed)).items).toHaveLength(1);
  });

  it('does not expose unexpected errors', async () => {
    const getStore = () => ({
      list: async () => { throw new Error('secret implementation detail'); },
      create: async () => { throw new Error('secret implementation detail'); },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await createHandler(getStore)(event('GET /v1/endpoints'), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 500 });
    expect(responseBody(response)).not.toContain('secret implementation detail');
    consoleError.mockRestore();
  });
});
