import { describe, expect, it, vi } from 'vitest';

import { PageSpeedClient } from './pagespeed-client.js';

describe('PageSpeedClient', () => {
  it('requests all dashboard categories and maps Lighthouse results', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      lighthouseResult: {
        categories: {
          performance: { score: 0.91 },
          accessibility: { score: 0.88 },
          'best-practices': { score: 0.77 },
          seo: { score: 1 },
        },
        audits: {
          'first-contentful-paint': { numericValue: 1234.56 },
          'largest-contentful-paint': { numericValue: 2345.67 },
          'cumulative-layout-shift': { numericValue: 0.12 },
        },
      },
    }), { status: 200 }));
    const client = new PageSpeedClient({
      fetchImplementation,
      now: () => new Date('2026-09-08T00:00:00.000Z'),
      apiKey: 'test-key',
    });

    await expect(client.analyze('endpoint-1', 'https://example.com')).resolves.toEqual({
      endpointId: 'endpoint-1',
      measuredAt: '2026-09-08T00:00:00.000Z',
      strategy: 'MOBILE',
      performanceScore: 91,
      accessibilityScore: 88,
      bestPracticesScore: 77,
      seoScore: 100,
      firstContentfulPaintMs: 1234.56,
      largestContentfulPaintMs: 2345.67,
      cumulativeLayoutShift: 0.12,
    });

    const request = new URL(fetchImplementation.mock.calls[0]?.[0] as string);
    expect(request.searchParams.getAll('category')).toEqual([
      'performance', 'accessibility', 'best-practices', 'seo',
    ]);
    expect(request.searchParams.get('strategy')).toBe('mobile');
    expect(request.searchParams.get('key')).toBe('test-key');
  });

  it('fails safely when Google rejects the request', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const client = new PageSpeedClient({ fetchImplementation });

    await expect(client.analyze('endpoint-1', 'https://example.com'))
      .rejects.toThrow('PageSpeed rejected the request with HTTP 429.');
  });
});
