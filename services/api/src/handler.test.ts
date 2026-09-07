import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

import { EndpointStore } from './endpoint-store.js';
import { createHandler } from './handler.js';

function event(routeKey: string, body?: string, pathParameters?: Record<string, string>): APIGatewayProxyEventV2 {
  return { routeKey, body, pathParameters } as APIGatewayProxyEventV2;
}

function responseBody(response: unknown): string {
  if (typeof response !== 'object' || response === null || !('body' in response)) {
    return '';
  }

  return typeof response.body === 'string' ? response.body : '';
}

describe('API handler', () => {
  it('returns the Phase 3 health response without opening the repository', async () => {
    const getStore = vi.fn();
    const response = await createHandler(getStore)(event('GET /v1/health'), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(responseBody(response))).toEqual({ status: 'ok', phase: 3 });
    expect(getStore).not.toHaveBeenCalled();
  });

  it('creates and lists endpoints through the injected repository', async () => {
    const store = new EndpointStore([], {
      createId: () => 'endpoint-123',
      now: () => new Date('2026-09-02T01:30:00.000Z'),
    });
    const upsert = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler(
      () => store,
      vi.fn(),
      () => ({ upsert, remove: vi.fn() }),
    );

    const created = await handler(event('POST /v1/endpoints', JSON.stringify({
      name: 'Example',
      url: 'https://example.com',
      intervalMinutes: 15,
    })), {} as never, vi.fn());
    const listed = await handler(event('GET /v1/endpoints'), {} as never, vi.fn());

    expect(created).toMatchObject({ statusCode: 201 });
    expect(JSON.parse(responseBody(listed)).items).toHaveLength(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'endpoint-123' }));
  });

  it('does not expose unexpected errors', async () => {
    const getStore = () => ({
      list: async () => { throw new Error('secret implementation detail'); },
      get: async () => undefined,
      create: async () => { throw new Error('secret implementation detail'); },
      update: async () => undefined,
      delete: async () => false,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await createHandler(getStore)(event('GET /v1/endpoints'), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 500 });
    expect(responseBody(response)).not.toContain('secret implementation detail');
    consoleError.mockRestore();
  });

  it('starts an ECS check for an existing endpoint', async () => {
    const store = new EndpointStore([{
      id: 'endpoint-123',
      name: 'Production API',
      url: 'https://example.com/health',
      intervalMinutes: 15,
      enabled: true,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }]);
    const start = vi.fn().mockResolvedValue({ taskArn: 'arn:task/example', status: 'STARTED' });
    const handler = createHandler(() => store, () => ({ start }));

    const response = await handler(
      event('POST /v1/endpoints/{id}/checks', undefined, { id: 'endpoint-123' }),
      {} as never,
      vi.fn(),
    );

    expect(response).toMatchObject({ statusCode: 202 });
    expect(JSON.parse(responseBody(response))).toEqual({ taskArn: 'arn:task/example', status: 'STARTED' });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: 'endpoint-123' }));
  });

  it('returns 404 without starting ECS when the endpoint does not exist', async () => {
    const start = vi.fn();
    const handler = createHandler(() => new EndpointStore(), () => ({ start }));

    const response = await handler(
      event('POST /v1/endpoints/{id}/checks', undefined, { id: 'missing' }),
      {} as never,
      vi.fn(),
    );

    expect(response).toMatchObject({ statusCode: 404 });
    expect(start).not.toHaveBeenCalled();
  });

  it('updates the endpoint and its recurring schedule together', async () => {
    const store = new EndpointStore([{
      id: 'endpoint-123',
      name: 'Production API',
      url: 'https://example.com/health',
      intervalMinutes: 15,
      enabled: true,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }]);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler(
      () => store,
      vi.fn(),
      () => ({ upsert, remove: vi.fn() }),
    );

    const response = await handler(
      event('PATCH /v1/endpoints/{id}', JSON.stringify({ intervalMinutes: 30, enabled: false }), {
        id: 'endpoint-123',
      }),
      {} as never,
      vi.fn(),
    );

    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(responseBody(response))).toMatchObject({ intervalMinutes: 30, enabled: false });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ intervalMinutes: 30, enabled: false }));
  });

  it('removes the recurring schedule before deleting its endpoint', async () => {
    const store = new EndpointStore([{
      id: 'endpoint-123',
      name: 'Production API',
      url: 'https://example.com/health',
      intervalMinutes: 15,
      enabled: true,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler(
      () => store,
      vi.fn(),
      () => ({ upsert: vi.fn(), remove }),
    );

    const response = await handler(
      event('DELETE /v1/endpoints/{id}', undefined, { id: 'endpoint-123' }),
      {} as never,
      vi.fn(),
    );

    expect(response).toMatchObject({ statusCode: 200 });
    expect(remove).toHaveBeenCalledWith('endpoint-123');
    await expect(store.get('endpoint-123')).resolves.toBeUndefined();
  });
});
