import { describe, expect, it, vi } from 'vitest';

import { CloudSentinelApiClient } from './api-client.js';

describe('CloudSentinelApiClient', () => {
  it('lists endpoints from the configured API', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: 'endpoint-1', name: 'Production API' }],
    }), { status: 200 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com/',
      fetchClient,
    );

    const endpoints = await client.listEndpoints();

    expect(endpoints[0]?.id).toBe('endpoint-1');
    expect(fetchClient).toHaveBeenCalledWith(
      'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints',
      undefined,
    );
  });

  it('posts endpoint input as JSON', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'endpoint-2',
      name: 'Status page',
    }), { status: 201 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com',
      fetchClient,
    );

    await client.createEndpoint({
      name: 'Status page',
      url: 'https://example.com/status',
      intervalMinutes: 15,
    });

    expect(fetchClient).toHaveBeenCalledWith(
      'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('Status page') }),
    );
  });

  it('returns the safe API error message', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'URL must use HTTP or HTTPS.' },
    }), { status: 400 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com',
      fetchClient,
    );

    await expect(client.createEndpoint({
      name: 'Unsafe',
      url: 'file:///etc/passwd',
      intervalMinutes: 15,
    })).rejects.toThrow('URL must use HTTP or HTTPS.');
  });

  it('starts a check for an encoded endpoint ID', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      taskArn: 'arn:task/example',
      status: 'STARTED',
    }), { status: 202 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com',
      fetchClient,
    );

    await expect(client.startCheck('endpoint/123')).resolves.toEqual({
      taskArn: 'arn:task/example',
      status: 'STARTED',
    });
    expect(fetchClient).toHaveBeenCalledWith(
      'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints/endpoint%2F123/checks',
      { method: 'POST' },
    );
  });

  it('runs a PageSpeed performance check for an encoded endpoint ID', async () => {
    const result = {
      endpointId: 'endpoint/123',
      measuredAt: '2026-09-08T00:00:00.000Z',
      strategy: 'MOBILE',
      performanceScore: 91,
      accessibilityScore: 88,
      bestPracticesScore: 77,
      seoScore: 100,
    };
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com',
      fetchClient,
    );

    await expect(client.runPerformance('endpoint/123')).resolves.toEqual(result);
    expect(fetchClient).toHaveBeenCalledWith(
      'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints/endpoint%2F123/performance',
      { method: 'POST' },
    );
  });

  it('loads analytics for an encoded date range', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
      totalChecks: 4,
      upChecks: 3,
      downChecks: 1,
      uptimePercent: 75,
      averageResponseTimeMs: 120,
      incidentCount: 1,
    }), { status: 200 }));
    const client = new CloudSentinelApiClient(
      'https://abc.execute-api.us-east-1.amazonaws.com',
      fetchClient,
    );

    await client.getAnalyticsOverview({
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
    });

    expect(fetchClient).toHaveBeenCalledWith(
      'https://abc.execute-api.us-east-1.amazonaws.com/v1/analytics/overview?from=2026-09-07T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z',
      undefined,
    );
  });

  it('updates, deletes, and lists incidents for an encoded endpoint ID', async () => {
    const fetchClient = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'endpoint/123', name: 'Updated' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const client = new CloudSentinelApiClient('https://abc.execute-api.us-east-1.amazonaws.com', fetchClient);

    await client.updateEndpoint('endpoint/123', { enabled: false });
    await client.deleteEndpoint('endpoint/123');
    await client.listIncidents('endpoint/123');

    expect(fetchClient).toHaveBeenNthCalledWith(1, 'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints/endpoint%2F123', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchClient).toHaveBeenNthCalledWith(2, 'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints/endpoint%2F123', { method: 'DELETE' });
    expect(fetchClient).toHaveBeenNthCalledWith(3, 'https://abc.execute-api.us-east-1.amazonaws.com/v1/endpoints/endpoint%2F123/incidents', undefined);
  });

  it('sends the optional bearer access token', async () => {
    const fetchClient = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const client = new CloudSentinelApiClient('https://abc.execute-api.us-east-1.amazonaws.com', fetchClient, 'demo-token');

    await client.listEndpoints();

    const init = fetchClient.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer demo-token');
  });
});
