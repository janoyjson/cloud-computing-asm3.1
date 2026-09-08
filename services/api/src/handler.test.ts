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
  it('returns the Phase 5 health response without opening the repository', async () => {
    const getStore = vi.fn();
    const response = await createHandler(getStore)(event('GET /v1/health'), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(responseBody(response))).toEqual({ status: 'ok', phase: 5 });
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
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
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

  it('runs and lists a PageSpeed performance measurement', async () => {
    const store = new EndpointStore([{
      id: 'endpoint-123',
      name: 'Production API',
      url: 'https://example.com/health',
      intervalMinutes: 15,
      enabled: true,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }]);
    const result = {
      endpointId: 'endpoint-123',
      measuredAt: '2026-09-08T00:00:00.000Z',
      strategy: 'MOBILE' as const,
      performanceScore: 91,
      accessibilityScore: 88,
      bestPracticesScore: 77,
      seoScore: 100,
    };
    const analyze = vi.fn().mockResolvedValue(result);
    const save = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue([result]);
    const handler = createHandler(
      () => store,
      vi.fn(),
      vi.fn(),
      () => ({ analyze }),
      () => ({ save, list }),
    );

    const created = await handler(
      event('POST /v1/endpoints/{id}/performance', undefined, { id: 'endpoint-123' }),
      {} as never,
      vi.fn(),
    );
    const listed = await handler(
      event('GET /v1/endpoints/{id}/performance', undefined, { id: 'endpoint-123' }),
      {} as never,
      vi.fn(),
    );

    expect(created).toMatchObject({ statusCode: 201 });
    expect(JSON.parse(responseBody(created))).toEqual(result);
    expect(JSON.parse(responseBody(listed))).toEqual({ items: [result] });
    expect(analyze).toHaveBeenCalledWith('endpoint-123', 'https://example.com/health');
    expect(save).toHaveBeenCalledWith(result);
    expect(list).toHaveBeenCalledWith('endpoint-123');
  });

  it('returns Athena-backed analytics for the requested range', async () => {
    const overview = {
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
      totalChecks: 4,
      upChecks: 3,
      downChecks: 1,
      uptimePercent: 75,
      averageResponseTimeMs: 120,
      incidentCount: 1,
    };
    const analytics = vi.fn().mockResolvedValue(overview);
    const handler = createHandler(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => ({ overview: analytics }),
    );

    const response = await handler({
      routeKey: 'GET /v1/analytics/overview',
      queryStringParameters: { from: overview.from, to: overview.to },
    } as unknown as APIGatewayProxyEventV2, {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(responseBody(response))).toEqual(overview);
    expect(analytics).toHaveBeenCalledWith({ from: overview.from, to: overview.to });
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

  it('returns a validation error for an unsafe endpoint URL', async () => {
    const handler = createHandler(
      () => new EndpointStore(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      async () => { throw new Error('URL resolves to a blocked destination.'); },
    );

    const response = await handler(event('POST /v1/endpoints', JSON.stringify({
      name: 'Internal service',
      url: 'http://169.254.169.254/latest/meta-data',
      intervalMinutes: 15,
    })), {} as never, vi.fn());

    expect(response).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(responseBody(response))).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'URL resolves to a blocked destination.' },
    });
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
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
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
