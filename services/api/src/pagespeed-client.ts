import type { PerformanceResult } from '@cloudsentinel/shared';

type FetchImplementation = typeof fetch;

interface PageSpeedClientOptions {
  apiKey?: string;
  fetchImplementation?: FetchImplementation;
  now?: () => Date;
}

interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: Record<string, { score?: number }>;
    audits?: Record<string, { numericValue?: number }>;
  };
}

function score(categories: Record<string, { score?: number }> | undefined, name: string): number {
  const value = categories?.[name]?.score;
  if (typeof value !== 'number') {
    throw new Error(`PageSpeed response did not include the ${name} score.`);
  }
  return Number((value * 100).toFixed(2));
}

function metric(audits: Record<string, { numericValue?: number }> | undefined, name: string): number | undefined {
  const value = audits?.[name]?.numericValue;
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

export class PageSpeedClient {
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchImplementation;
  readonly #now: () => Date;

  public constructor(options: PageSpeedClientOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  public async analyze(endpointId: string, url: string): Promise<PerformanceResult> {
    const requestUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    requestUrl.searchParams.set('url', url);
    requestUrl.searchParams.append('category', 'performance');
    requestUrl.searchParams.append('category', 'accessibility');
    requestUrl.searchParams.append('category', 'best-practices');
    requestUrl.searchParams.append('category', 'seo');
    requestUrl.searchParams.set('strategy', 'mobile');
    if (this.#apiKey) {
      requestUrl.searchParams.set('key', this.#apiKey);
    }

    const response = await this.#fetch(requestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(`PageSpeed rejected the request with HTTP ${response.status}.`);
    }

    const payload = await response.json() as PageSpeedResponse;
    const lighthouse = payload.lighthouseResult;
    return {
      endpointId,
      measuredAt: this.#now().toISOString(),
      strategy: 'MOBILE',
      performanceScore: score(lighthouse?.categories, 'performance'),
      accessibilityScore: score(lighthouse?.categories, 'accessibility'),
      bestPracticesScore: score(lighthouse?.categories, 'best-practices'),
      seoScore: score(lighthouse?.categories, 'seo'),
      firstContentfulPaintMs: metric(lighthouse?.audits, 'first-contentful-paint'),
      largestContentfulPaintMs: metric(lighthouse?.audits, 'largest-contentful-paint'),
      cumulativeLayoutShift: metric(lighthouse?.audits, 'cumulative-layout-shift'),
    };
  }
}
