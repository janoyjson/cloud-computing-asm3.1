import { describe, expect, it, vi } from 'vitest';

import { checkEndpoint } from './check-endpoint.js';

const resolvePublicHost = async () => ['93.184.216.34'];

describe('checkEndpoint', () => {
  it('records a successful HTTP response', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const timestamps = [1_000, 1_145];

    const result = await checkEndpoint(
      { endpointId: 'endpoint-1', url: 'https://example.com/health', source: 'MANUAL' },
      fetchImplementation,
      () => timestamps.shift() ?? 1_145,
      resolvePublicHost,
    );

    expect(result).toMatchObject({ state: 'UP', statusCode: 204, responseTimeMs: 145 });
  });

  it('records server errors as downtime', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    const result = await checkEndpoint(
      { endpointId: 'endpoint-1', url: 'https://example.com/health', source: 'SCHEDULED' },
      fetchImplementation,
      () => 1_000,
      resolvePublicHost,
    );

    expect(result).toMatchObject({ state: 'DOWN', statusCode: 503 });
  });

  it('converts network failures into a safe result', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'));

    const result = await checkEndpoint(
      { endpointId: 'endpoint-1', url: 'https://example.com/health', source: 'SCHEDULED' },
      fetchImplementation,
      () => 1_000,
      resolvePublicHost,
    );

    expect(result).toMatchObject({ state: 'DOWN', error: 'connection refused' });
  });

  it('revalidates and follows a public redirect', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://www.example.com/health' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await checkEndpoint(
      { endpointId: 'endpoint-1', url: 'https://example.com', source: 'MANUAL' },
      fetchImplementation,
      () => 1_000,
      resolvePublicHost,
    );

    expect(result.state).toBe('UP');
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to a private destination', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }));

    const result = await checkEndpoint(
      { endpointId: 'endpoint-1', url: 'https://example.com', source: 'MANUAL' },
      fetchImplementation,
      () => 1_000,
      resolvePublicHost,
    );

    expect(result).toMatchObject({ state: 'DOWN', error: 'Monitor URL resolves to a blocked destination.' });
  });
});
