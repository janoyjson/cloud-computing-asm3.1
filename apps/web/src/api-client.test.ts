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
});
